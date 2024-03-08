<?php
/* Copyright (C) 2024, Manuel Meitinger
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

declare(strict_types=1);

require_once('common.php');

session_start();

class CachedToken
{
	private const TOKENS = 'tokens';
	private ?string $reason = null;
	private ?string $oid = null;
	private ?array $roles = null;

	private static function &get_cache(): array
	{
		if (!isset($_SESSION[self::TOKENS]) || !is_array($_SESSION[self::TOKENS])) {
			$_SESSION[self::TOKENS] = [];
		}
		return $_SESSION[self::TOKENS];
	}

	private function __construct(string $token)
	{
		$tokens = &self::get_cache();
		$tokens[$token] = $this;
	}

	public static function get(string $token): ?self
	{
		$tokens = &self::get_cache();
		if (isset($tokens[$token])) {
			$result = $tokens[$token];
			if ($result instanceof self) return $result;
			return fail('invalid cache data', 500);
		}
		return null;
	}

	public static function fail(string $token, string $reason): self
	{
		$result = new self($token);
		$result->reason = $reason;
		return $result;
	}

	public static function succeed(string $token, string $oid, array $roles): self
	{
		$result = new self($token);
		$result->oid = $oid;
		$result->roles = $roles;
		return $result;
	}

	public function get_result(bool $management): string
	{
		if (!is_null($this->reason)) return fail($this->reason);
		if (is_null($this->oid) || is_null($this->roles)) return fail('invalid cache data', 500);
		if ($management && !in_array('Manage', $this->roles, strict: true)) return fail('management role required', code: 403);
		return $this->oid;
	}
}

class OicdException extends Exception
{
	public function __construct(string $reason, string $url)
	{
		parent::__construct('token oicd error: ' . $reason . ' (' . $url . ')');
	}
}

function base64_url_decode(string $string): string
{
	$remainder = strlen($string) % 4;
	if ($remainder) {
		$string .= str_repeat('=', 4 - $remainder);
	}
	return base64_decode(strtr($string, '-_', '+/'));
}

function db_decode(mixed $json): ?array
{
	if (is_null($json)) return null;
	$data = json_decode($json, associative: true);
	if (is_null($data)) throw new Exception('database returned invalid data (' . $json . ')');
	return $data;
}

function body(): string
{
	return file_get_contents('php://input');
}

function fail(string $reason, int $code = 400): never
{
	http_response_code($code);
	header('Content-Type: application/json');
	echo json_encode([
		'result' => 'FAILED',
		'reason' => $reason,
	]);
	session_commit();
	exit(1);
}

function succeed(?array $data = null, int $code = 200): never
{
	http_response_code($code);
	header('Content-Type: application/json');
	echo json_encode($data ?? [
		'result' => 'SUCCEEDED',
	]);
	session_commit();
	exit(0);
}

function require_token(bool $management = false): string
{
	// retrieve the token string and any cached result
	if (!isset($_SERVER['HTTP_X_ID_TOKEN'])) return fail('missing token');
	$token = $_SERVER['HTTP_X_ID_TOKEN'];
	$cached = CachedToken::get($token);
	if (!is_null($cached)) return $cached->get_result($management);

	// define helper functions
	function fail_cached(string $reason): string
	{
		global $token;
		global $management;
		return CachedToken::fail($token, $reason)->get_result($management);
	}

	// check the token data
	$parts = explode('.', $token);
	if (count($parts) !== 3) return fail_cached('invalid number of token parts');
	$header = json_decode(base64_url_decode($parts[0]), associative: true);
	if (is_null($header)) return fail_cached('invalid token header');
	$payload = json_decode(base64_url_decode($parts[1]), associative: true);
	if (is_null($payload)) return fail_cached('invalid token payload');
	$missingHeaders = array_filter(['typ', 'alg', 'kid'], fn (string $key) => !isset($header[$key]));
	if ($missingHeaders) return fail_cached('missing token headers: ' . implode(',', $missingHeaders));
	if ($header['typ'] !== 'JWT') return fail_cached('unsupported token type');
	if ($header['alg'] !== 'RS256') return fail_cached('unsupported token algorithm');
	$missingClaims = array_filter(['aud', 'exp', 'iss', 'nbf', 'oid', 'roles', 'tid', 'ver'], fn (string $key) => !isset($payload[$key]));
	if ($missingClaims) return fail_cached('missing token claims: ' . implode(',', $missingClaims));
	if ($payload['tid'] !== get_config_string('auth.tenant')) return fail_cached('tenant mismatch in token');
	if ($payload['aud'] !== get_config_string('auth.client')) return fail_cached('client app ID mismatch in token');
	if (!is_numeric($payload['nbf']) || time() < $payload['nbf']) return fail_cached('token not yet valid');
	if (!is_numeric($payload['exp']) || $payload['exp'] < time()) return fail_cached('token expired');
	$oid = $payload['oid'];
	if (!is_string($oid)) return fail_cached('oid must be a string');
	$roles = $payload['roles'];
	if (!is_array($roles)) return fail_cached('roles must be an array');

	// get the OICD endpoint
	$metaUrl = 'https://login.microsoftonline.com/' . get_config_string('auth.tenant');
	if ($payload['ver'] === '2.0') {
		$metaUrl .= '/v2.0';
	} elseif ($payload['ver'] !== '1.0') {
		return fail_cached('unsupported token version');
	}
	$metaUrl .= '/.well-known/openid-configuration';

	// verify the token signature
	$meta = json_decode(file_get_contents($metaUrl), associative: true);
	if (is_null($meta)) throw new OicdException('invalid meta data', $metaUrl);
	if (!isset($meta['issuer'])) throw new OicdException('`issuer` not found', $metaUrl);
	if ($payload['iss'] !== $meta['issuer']) return fail_cached('invalid token issuer');
	if (!isset($meta['jwks_uri']) || !is_string($meta['jwks_uri'])) throw new OicdException('`jwks_uri` string not found', $metaUrl);
	$jkwsUrl = $meta['jwks_uri'];
	$jwks = json_decode(file_get_contents($jkwsUrl), associative: true);
	if (is_null($jwks)) throw new OicdException('invalid keys data', $jkwsUrl);
	if (!isset($jwks['keys']) || !is_array($jwks['keys'])) throw new OicdException('`keys` array found', $jkwsUrl);
	$keyId = $header['kid'];
	foreach ($jwks['keys'] as $key) {
		if (isset($key['kid']) && $key['kid'] === $keyId) {
			if (!isset($key['x5c'][0]) || !is_string($key['x5c'][0])) throw new OicdException('first `x5c` string of key "' . $keyId . '" not found', $jkwsUrl);
			$cert = openssl_get_publickey('-----BEGIN CERTIFICATE-----' . chr(10) . $key['x5c'][0] . chr(10) . '-----END CERTIFICATE-----');
			if ($cert === false) throw new OicdException('certificate of key "' . $keyId . '" is invalid', $jkwsUrl);
			$verified = openssl_verify(
				data: $parts[0] . '.' . $parts[1],
				signature: base64_url_decode($parts[2]),
				public_key: $cert,
				algorithm: OPENSSL_ALGO_SHA256
			);
			if ($verified === 1) {
				return CachedToken::succeed($token, $oid, $roles)->get_result($management);
			}
			if ($verified === 0) return fail_cached('invalid token signature');
			throw new Exception('signature verification failed');
		}
	}
	return fail_cached('no matching key found');
}

function require_method(string ...$methods): string
{
	$method = $_SERVER['REQUEST_METHOD'];
	if (!in_array($method, $methods, strict: true)) {
		return fail('allowed methods: ' . implode(',', $methods), code: 405);
	}
	return $method;
}

function api(array $methods, bool $management = false): never
{
	global $db;

	$method = require_method(...$methods);
	$invoker = require_token($management);
	$stmt = $db->prepare('CALL `API_USER_' . strtoupper($_SERVER['QUERY_STRING']) . '_' . $method . '`(?, ?)');
	$stmt->execute([$invoker, body()]);
	succeed();
}

function changes(): never
{
	global $db;

	require_method('POST');
	$invoker = require_token();
	$stmt = $db->prepare('CALL `API_USER_CHANGES_POST`(?, ?, @response)');
	$stmt->execute([$invoker, body()]);
	$query = $db->query('SELECT @response');
	[$response] = $query->fetch_array();
	succeed(db_decode($response));
}

function product(): never
{
	global $db;

	$method = require_method('PUT', 'POST', 'DELETE');
	$invoker = require_token();
	$start_stmt = $db->prepare('CALL `API_USER_PRODUCT_' . $method . '_START`(?, ?, @uri, @body)');
	$start_stmt->execute([$invoker, body()]);
	$query = $db->query('SELECT @uri, @body');
	[$uri, $body] = $query->fetch_array();
	$data = db_decode($body);
	if ($method === 'PUT') {
		$data = array_merge(get_config_array('defaults'), $data);
	}
	$lock = new Lock(get_config_string('webhook.lockFile'));
	try {
		$result = call($method, $uri, $data);
		$end_stmt = $db->prepare('CALL `API_USER_PRODUCT_' . $method . '_END`(?, ?)');
		$end_stmt->execute([$invoker, json_encode($result)]);
	} finally {
		$lock->release();
	}
	succeed();
}

function sync(): never
{
	global $db;

	require_method('GET');
	require_token(management: true);

	$start_stmt = $db->prepare('CALL `API_SYSTEM_SYNC_START`()');
	$start_stmt->execute();

	$productgroup_count = 0;
	for ($page = 1;; $page++) {
		$productgroups = call('GET', '/v1/productgroups?page=' . $page . '&limit=250');
		if (!$productgroups) {
			break;
		}
		$productgroup_count += count($productgroups);
		$productgroup_stmt = $db->prepare('CALL `API_SYSTEM_SYNC`(\'productGroup\', ?)');
		$productgroup_stmt->execute([json_encode($productgroups)]);
	}

	$product_count = 0;
	for ($page = 1;; $page++) {
		$products = call('GET', '/v1/products?page=' . $page . '&limit=250&includeProductGroup');
		if (!$products) {
			break;
		}
		$product_count += count($products);
		$product_stmt = $db->prepare('CALL `API_SYSTEM_SYNC`(\'product\', ?)');
		$product_stmt->execute([json_encode($products)]);
	}

	$end_stmt = $db->prepare('CALL `API_SYSTEM_SYNC_END`()');
	$end_stmt->execute();

	succeed([
		'numberOfProducts' => $product_count,
		'numberOfProductGroups' => $productgroup_count,
	]);
}

try {
	switch ($_SERVER['QUERY_STRING']) {
		case 'changes':
			changes();
		case 'product':
			product();
		case 'productPermission':
			api(['DELETE', 'PUT'], management: true);
		case 'stock':
			api(['POST']);
		case 'storage':
			api(['DELETE', 'POST', 'PUT'], management: true);
		case 'storagePermission':
			api(['DELETE', 'PUT'], management: true);
		case 'sync':
			sync();
		default:
			fail('unknown API call');
	}
} catch (mysqli_sql_exception $ex) {
	$state = $ex->getSqlState();
	if (str_starts_with($state, '45')) {
		$code = intval(substr($state, offset: 2, length: 3));
	} else {
		$code = 400;
	}
	fail($ex->getMessage(), code: $code);
} catch (Exception $ex) {
	fail(strval($ex), code: 500);
}
