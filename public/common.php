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

require_once('config.php');

// turn errors into exceptions
error_reporting(E_ALL);
set_error_handler(function (int $errno, string $errstr, string $errfile, int $errline) {
	throw new ErrorException(
		message: $errstr,
		code: $errno,
		filename: $errfile,
		line: $errline
	);
});

// config helper functions
function get_config(string $path, array|bool|float|int|string|null $default, string $type): array|bool|float|int|string
{
	global $config;

	$value = $config;
	foreach (explode('.', $path) as $segment) {
		if (!$segment) throw new InvalidArgumentException('config path must not include empty segments');
		if (!isset($value[$segment])) {
			if (is_null($default)) throw new Exception('config value "' . $path . '" must be set');
			return $default;
		}
		$value = $value[$segment];
	}
	$test = 'is_' . $type;
	if (!$test($value)) throw new TypeError('config value "' . $path . '" must be a "' . $type . '"');
	return $value;
}
function get_config_array(string $path, ?array $default = null): array
{
	return get_config($path, $default, 'array');
}
function get_config_bool(string $path, ?bool $default = null): bool
{
	return get_config($path, $default, 'bool');
}
function get_config_int(string $path, ?int $default = null): int
{
	return get_config($path, $default, 'int');
}
function get_config_float(string $path, ?float $default = null): int
{
	return get_config($path, $default, 'float');
}
function get_config_string(string $path, ?string $default = null): string
{
	return get_config($path, $default, 'string');
}

// helper class for mutexes
class Lock
{
	private string $filename;
	private $stream;

	private function check(mixed $result, string $operation): void
	{
		if ($result === false) {
			throw new Exception('failed to ' . $operation . ' "' . $this->filename . '"');
		}
	}

	public function __construct(string $filename)
	{
		$this->filename = $filename;
		$this->stream = fopen($filename, 'r');
		$this->check($this->stream, 'open');
		$this->check(flock($this->stream, LOCK_EX), 'lock');
	}

	public function release(): void
	{
		$this->check(flock($this->stream, LOCK_UN), 'unlock');
	}

	public function __destruct()
	{
		$this->check(fclose($this->stream), 'close');
	}
}

// read2order API function
function call(string $method, string $uri, ?array $body = null): array
{
	$headers = ['Authorization: Bearer ' . get_config_string('api.accountToken')];
	if ($body) {
		$headers[] = 'Content-Type: application/json';
		$content = json_encode($body);
	} else {
		$content = '';
	}
	$context = stream_context_create([
		'http' => [
			'method' => $method,
			'header' => $headers,
			'content' => $content,
			'ignore_errors' => true,
		]
	]);
	$lock = new Lock(get_config_string('api.lockFile'));
	try {
		$start = hrtime(as_number: true);
		$result = file_get_contents(filename: 'https://api.ready2order.com' . $uri, context: $context);
		$duration = hrtime(as_number: true) - $start;
		if ($duration < 1000000000) {
			// throttle calls to one per second
			time_nanosleep(0, 1000000000 - $duration);
		}
	} finally {
		$lock->release();
	}
	$data = json_decode($result, associative: true);
	if (is_null($data)) {
		throw new Exception('ready2order returned invalid data (' . $result . ')');
	}
	if (isset($data['error']) && $data['error']) {
		throw new Exception(isset($data['msg']) ? strval($data['msg']) : 'unknown ready2order error');
	}
	return $data;
}

// open the database connection
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
$db = new mysqli(
	hostname: get_config_string('db.hostname'),
	username: get_config_string('db.username'),
	password: get_config_string('db.password'),
	database: get_config_string('db.database'),
	port: get_config_int('db.port', 3306)
);
$db->set_charset('utf8mb4');
