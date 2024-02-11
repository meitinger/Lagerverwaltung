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

$config = [
	'db' => [
		'hostname' => 'localhost',
		'database' => 'lager_db',
		'username' => 'api_user',
		'password' => 'Passw0rd',
		// 'revision' => 'optional-suffix-for-indexedDB-name'
	],
	'auth' => [
		'tenant' => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
		'client' => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
	],
	'api' => [
		'endpoint' => 'https://example.org/path/to/api.php',
		'lockFile' => '/path/to/api.lock',
		'accountToken' => 'ey... (see https://ready2order.com/api/doc#section/Types-of-tokens)',
	],
	'webhook' => [
		'endpoint' => 'https://example.org/path/to/webhook.php',
		'lockFile' => '/path/to/webhook.lock',
		'secret' => 'very-long-hard-to-guess-string',
	],
	'defaults' => [
		'product_PROPERTY' => 'default value, e.g.',
		'product_name' => '',
		'product_price' => 0,
		'product_vat' => 10,
		'product_priceIncludesVat' => true,
		'product_stock_value' => 0,
		'product_stock_unit' => 'piece',
	],
];
