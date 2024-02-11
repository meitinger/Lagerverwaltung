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

header('Content-Type: application/javascript');

echo 'window.config = ', json_encode(
    array_merge([
        'api_endpoint' => get_config_string('api.endpoint'),
        'auth_tenant' => get_config_string('auth.tenant'),
        'auth_client' => get_config_string('auth.client'),
        'sync_database' => get_config_string('db.database') . get_config_string('db.revision', ''),
        'sync_interval' => get_config_int('sync.interval', 5000),
        'sync_protocol' => get_config_string('sync.protocol', 'sync'),
    ], get_config_array('defaults'))
), ';';
