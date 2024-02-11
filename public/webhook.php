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

if (get_config_string('webhook.secret') !== $_SERVER['QUERY_STRING']) {
	http_response_code(403);
	exit(1);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
	try {
		$url = get_config_string('webhook.endpoint') . '?' . get_config_string('webhook.secret');
		$webhook = call('GET', '/v1/webhook');
		if ($webhook['webhookUrl'] !== $url) {
			$webhook = call('POST', '/v1/webhook', ['webhookUrl' => $url]);
		}
		$events = call('GET', '/v1/webhook/events');
		$requiredEvents = [
			'product.created',
			'product.updated',
			'product.deleted',
			'productGroup.created',
			'productGroup.updated',
			'productGroup.deleted',
		];
		$activeEvents = $events['activeEvents'];
		$addEvents = array_diff($requiredEvents, $activeEvents);
		$removeEvents = array_diff($activeEvents, $requiredEvents);
		if ($addEvents || $removeEvents) {
			foreach ($addEvents as $event) {
				call('POST', '/v1/webhook/events', ['addEvent' => $event]);
			}
			foreach ($removeEvents as $event) {
				call('POST', '/v1/webhook/events', ['removeEvent' => $event]);
			}
			$events = call('GET', '/v1/webhook/events');
		}
		echo 'webhookUrl=' . $webhook['webhookUrl'] . '<br/>';
		echo 'activeEvents=' . implode(',', $events['activeEvents']) . '<br/>';
		echo 'availableEvents=' . implode(',', $events['availableEvents']) . '<br/>';
		exit(0);
	} catch (Exception $ex) {
		echo strval($ex);
		exit(1);
	}
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
	http_response_code(405);
	exit(1);
}

if (!isset($_POST['resource']) || !is_array($_POST['resource'])) {
	http_response_code(400);
	exit(1);
}

$resource = $_POST['resource'];
foreach ($resource as $key => &$value) {
	if ($value === 'null') {
		$value = null;
	} elseif ($value === 'true') {
		$value = true;
	} elseif ($value === 'false') {
		$value = false;
	} elseif (is_numeric($value)) {
		$number = str_contains($value, '.') ? floatval($value) : intval($value);
		if (strval($number) === $value) {
			$value = $number;
		}
	}
}
$data = json_encode($resource);

$lock = new Lock(get_config_string('webhook.lockFile'));
try {
	$stmt = $db->prepare('CALL `API_SYSTEM_WEBHOOK`(?)');
	$stmt->execute([$data]);
} catch (mysqli_sql_exception $ex) {
	file_put_contents('webhook.log', '[' . gmdate('Y-m-d H:i:s') . '] ' . $ex->getMessage() . chr(10), FILE_APPEND);
} finally {
	$lock->release();
}
