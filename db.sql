-- Copyright (C) 2024, Manuel Meitinger
--
-- This program is free software: you can redistribute it and/or modify
-- it under the terms of the GNU General Public License as published by
-- the Free Software Foundation, either version 2 of the License, or
-- (at your option) any later version.
--
-- This program is distributed in the hope that it will be useful,
-- but WITHOUT ANY WARRANTY; without even the implied warranty of
-- MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
-- GNU General Public License for more details.
--
-- You should have received a copy of the GNU General Public License
-- along with this program.  If not, see <http://www.gnu.org/licenses/>.



SET SQL_MODE = 'STRICT_ALL_TABLES';
SET NAMES utf8mb4 COLLATE utf8mb4_bin;
SET time_zone = '+00:00';



DELIMITER $$



CREATE PROCEDURE `API_USER_CHANGES_POST`
(
    IN `invoker` TEXT,
    IN `request` JSON,
    OUT `response` JSON
)
READS SQL DATA
SQL SECURITY INVOKER
BEGIN
    CALL SET_USER_CONTEXT(`invoker`);
    CALL ENSURE_JSON_TYPE(`request`, 'OBJECT');

    BEGIN
        DECLARE `firstRevision` BIGINT UNSIGNED DEFAULT IFNULL(GET_OPTIONAL_BIGINT(`request`, '$.syncedRevision') + 1, 0);
        DECLARE `lastRevision` BIGINT UNSIGNED DEFAULT CURRENT_REVISION();

        SET `response` = JSON_OBJECT
        (
            'changes', (
                SELECT IFNULL(JSON_ARRAYAGG(`changes`.`change`), JSON_ARRAY())
                FROM
                (
                    (
                        SELECT
                            CASE
                                WHEN `objects`.`hasDelete` THEN JSON_OBJECT
                                (
                                    'type', 3,
                                    'table', `objects`.`table`,
                                    'key', BIN_TO_UUID(`objects`.`key`)
                                )
                                WHEN `objects`.`hasInsert` THEN JSON_OBJECT
                                (
                                    'type', 1,
                                    'table', `objects`.`table`,
                                    'key', BIN_TO_UUID(`objects`.`key`),
                                    'obj', MERGE_UPDATES(
                                        (
                                            SELECT JSON_EXTRACT(`changelog`.`change`, '$.obj')
                                            FROM `changelog`
                                            WHERE
                                                `changelog`.`table` = `objects`.`table`
                                                AND
                                                `changelog`.`key` = `objects`.`key`
                                                AND
                                                `changelog`.`type` = 1
                                                AND
                                                `changelog`.`revision` BETWEEN `firstRevision` AND `lastRevision`
                                        ),
                                        GET_LOG_UPDATES(`objects`.`table`, `objects`.`key`, `firstRevision`, `lastRevision`)
                                    )
                                )
                                ELSE JSON_OBJECT
                                (
                                    'type', 2,
                                    'table', `objects`.`table`,
                                    'key', BIN_TO_UUID(`objects`.`key`),
                                    'mods', GET_LOG_UPDATES(`objects`.`table`, `objects`.`key`, `firstRevision`, `lastRevision`)
                                )
                            END AS `change`
                        FROM
                        (
                            SELECT
                                `changelog`.`table` AS `table`,
                                `changelog`.`key` AS `key`,
                                MIN(`changelog`.`type`) < 2 AS `hasInsert`,
                                MAX(`changelog`.`type`) > 2 AS `hasDelete`
                            FROM `changelog`
                            WHERE `changelog`.`revision` BETWEEN `firstRevision` AND `lastRevision`
                            GROUP BY
                                `changelog`.`table`,
                                `changelog`.`key`
                        ) AS `objects`
                        WHERE NOT (`objects`.`hasInsert` AND `objects`.`hasDelete`)
                    )
                    UNION ALL
                    SELECT `changelog`.`obj` AS `change`
                    FROM `changelog`
                    WHERE `changelog`.`revision` BETWEEN `firstRevision` AND `lastRevision`
                ) AS `changes`
            ),
            'lastRevision', `lastRevision`
        );
    END;
END$$



CREATE PROCEDURE `API_USER_PRODUCT_DELETE_START`
(
    IN `invoker` TEXT,
    IN `data` JSON,
    OUT `uri` TEXT,
    OUT `body` JSON
)
MODIFIES SQL DATA
SQL SECURITY INVOKER
BEGIN
    CALL SET_USER_CONTEXT(`invoker`);
    CALL ENSURE_JSON_TYPE(`data`, 'OBJECT');

    BEGIN
        DECLARE `id` BINARY(16) DEFAULT GET_MANDATORY_ID(`data`, '$.id');
        DECLARE `groupId` BINARY(16);

        CALL PREPARE_PRODUCT_API_URL(`id`, `groupId`, `uri`);
        IF NOT CAN_REMOVE_PRODUCT(`groupId`) THEN
            SIGNAL SQLSTATE '45403' SET MESSAGE_TEXT = 'delete product not allowed';
        END IF;
        CALL SET_PRODUCT_API_METHOD('DELETE');
        SET @productId = `id`;
    END;
END$$



CREATE PROCEDURE `API_USER_PRODUCT_DELETE_END`
(
    IN `invoker` TEXT,
    IN `data` JSON
)
MODIFIES SQL DATA
SQL SECURITY INVOKER
BEGIN
    CALL SET_USER_CONTEXT(`invoker`);
    CALL ENSURE_PRODUCT_API_SUCCESS_AND_METHOD(`data`, 'DELETE');

    CALL DELETE_PRODUCT(@productId, NULL);
END$$



CREATE PROCEDURE `API_USER_PRODUCT_POST_START`
(
    IN `invoker` TEXT,
    IN `data` JSON,
    OUT `uri` TEXT,
    OUT `body` JSON
)
READS SQL DATA
SQL SECURITY INVOKER
BEGIN
    CALL SET_USER_CONTEXT(`invoker`);
    CALL ENSURE_JSON_TYPE(`data`, 'OBJECT');

    BEGIN
        DECLARE `id` BINARY(16) DEFAULT GET_MANDATORY_ID(`data`, '$.id');
        DECLARE `addGroupId` BINARY(16) DEFAULT GET_MANDATORY_ID(`data`, '$.groupId');
        DECLARE `removeGroupId` BINARY(16);

        CALL PREPARE_PRODUCT_API_URL(`id`, `removeGroupId`, `uri`);
        IF
            NOT `addGroupId` <=> `removeGroupId`
            AND NOT
            (
                CAN_ADD_PRODUCT(`addGroupId`)
                AND
                CAN_REMOVE_PRODUCT(`removeGroupId`)
            )
        THEN
            SIGNAL SQLSTATE '45403' SET MESSAGE_TEXT = 'move product not allowed';
        END IF;
        CALL ENSURE_PRODUCT_PROPERTIES(`addGroupId`, `data`);
        CALL SET_PRODUCT_API_METHOD('POST');
        CALL PREPARE_PRODUCT_API_BODY(`data`, `body`);
    END;
END$$



CREATE PROCEDURE `API_USER_PRODUCT_POST_END`
(
    IN `invoker` TEXT,
    IN `data` JSON
)
MODIFIES SQL DATA
SQL SECURITY INVOKER
BEGIN
    CALL SET_USER_CONTEXT(`invoker`);
    CALL ENSURE_PRODUCT_API_SUCCESS_AND_METHOD(`data`, 'POST');

    CALL INSERT_OR_UPDATE_PRODUCT(`data`);
END$$



CREATE PROCEDURE `API_USER_PRODUCT_PUT_START`
(
    IN `invoker` TEXT,
    IN `data` JSON,
    OUT `uri` TEXT,
    OUT `body` JSON
)
READS SQL DATA
SQL SECURITY INVOKER
BEGIN
    CALL SET_USER_CONTEXT(`invoker`);
    CALL ENSURE_JSON_TYPE(`data`, 'OBJECT');
    CALL ENSURE_EMPTY_ID(`data`, '$.id');

    BEGIN
        DECLARE `groupId` BINARY(16) DEFAULT GET_MANDATORY_ID(`data`, '$.groupId');

        SET `uri` = '/v1/products';
        IF NOT CAN_ADD_PRODUCT(`groupId`) THEN
            SIGNAL SQLSTATE '45403' SET MESSAGE_TEXT = 'create product not allowed';
        END IF;
        CALL ENSURE_PRODUCT_PROPERTIES(`groupId`, `data`);
        CALL SET_PRODUCT_API_METHOD('PUT');
        CALL PREPARE_PRODUCT_API_BODY(`data`, `body`);
    END;
END$$



CREATE PROCEDURE `API_USER_PRODUCT_PUT_END`
(
    IN `invoker` TEXT,
    IN `data` JSON
)
MODIFIES SQL DATA
SQL SECURITY INVOKER
BEGIN
    CALL SET_USER_CONTEXT(`invoker`);
    CALL ENSURE_PRODUCT_API_SUCCESS_AND_METHOD(`data`, 'PUT');

    CALL INSERT_OR_UPDATE_PRODUCT(`data`);
END$$



CREATE PROCEDURE `API_USER_PRODUCTPERMISSION_DELETE`
(
    IN `invoker` TEXT,
    IN `data` JSON
)
MODIFIES SQL DATA
SQL SECURITY INVOKER
BEGIN
    CALL SET_USER_CONTEXT(`invoker`);
    CALL ENSURE_JSON_TYPE(`data`, 'OBJECT');

    DELETE FROM `productPermission`
    WHERE
        `productPermission`.`groupId` <=> GET_OPTIONAL_ID(`data`, '$.groupId')
        AND
        `productPermission`.`userId` = GET_MANDATORY_ID(`data`, '$.userId');
END$$



CREATE PROCEDURE `API_USER_PRODUCTPERMISSION_PUT`
(
    IN `invoker` TEXT,
    IN `data` JSON
)
MODIFIES SQL DATA
SQL SECURITY INVOKER
BEGIN
    CALL SET_USER_CONTEXT(`invoker`);
    CALL ENSURE_JSON_TYPE(`data`, 'OBJECT');

    BEGIN
        DECLARE `id` BINARY(16);
        DECLARE `groupId` BINARY(16) DEFAULT GET_OPTIONAL_ID(`data`, '$.groupId');
        DECLARE `userId` BINARY(16) DEFAULT GET_MANDATORY_ID(`data`, '$.userId');
        DECLARE EXIT HANDLER FOR NOT FOUND
        BEGIN
            INSERT INTO `productPermission`
            SET
                `id` = UUID_TO_BIN(UUID()),
                `groupId` = `groupId`,
                `userId` = `userId`,
                `add` = CASE WHEN JSON_CONTAINS_PATH(`data`, 'all', '$.add')
                    THEN GET_BOOLEAN(`data`, '$.add')
                    ELSE FALSE
                END,
                `remove` = CASE WHEN JSON_CONTAINS_PATH(`data`, 'all', '$.remove')
                    THEN GET_BOOLEAN(`data`, '$.remove')
                    ELSE FALSE
                END,
                `properties` = CASE WHEN JSON_CONTAINS_PATH(`data`, 'all', '$.properties')
                    THEN GET_MANDATORY_STRING(`data`, '$.properties')
                    ELSE ''
                END;
        END;

        SELECT `productPermission`.`id`
        INTO `id`
        FROM `productPermission`
        WHERE
            `productPermission`.`groupId` <=> `groupId`
            AND
            `productPermission`.`userId` = `userId`
        FOR UPDATE;

        UPDATE `productPermission`
        SET
            `add` = CASE WHEN JSON_CONTAINS_PATH(`data`, 'all', '$.add')
                THEN GET_BOOLEAN(`data`, '$.add')
                ELSE `productPermission`.`add`
            END,
            `remove` = CASE WHEN JSON_CONTAINS_PATH(`data`, 'all', '$.remove')
                THEN GET_BOOLEAN(`data`, '$.remove')
                ELSE `productPermission`.`remove`
            END,
            `properties` = CASE WHEN JSON_CONTAINS_PATH(`data`, 'all', '$.properties')
                THEN GET_MANDATORY_STRING(`data`, '$.properties')
                ELSE `productPermission`.`properties`
            END
        WHERE `productPermission`.`id` = `id`;
    END;
END$$



CREATE PROCEDURE `API_USER_STOCK_POST`
(
    IN `invoker` TEXT,
    IN `data` JSON
)
MODIFIES SQL DATA
SQL SECURITY INVOKER
BEGIN
    CALL SET_USER_CONTEXT(`invoker`);
    CALL ENSURE_JSON_TYPE(`data`, 'OBJECT');

    BEGIN
        DECLARE `storageId` BINARY(16) DEFAULT GET_MANDATORY_ID(`data`, '$.storageId');

        IF NOT EXISTS
        (
            SELECT *
            FROM `storagePermission`
            WHERE
                (
                    `storagePermission`.`storageId` IS NULL
                    OR
                    `storagePermission`.`storageId` = `storageId`
                )
                AND
                `storagePermission`.`userId` = @currentUserId
                AND
                `storagePermission`.`stock`
        )
        THEN
            SIGNAL SQLSTATE '45403' SET MESSAGE_TEXT = 'stock operation not allowed';
        END IF;

        BEGIN
            DECLARE `id` BINARY(16);
            DECLARE `productId` BINARY(16) DEFAULT GET_MANDATORY_ID(`data`, '$.productId');
            DECLARE EXIT HANDLER FOR NOT FOUND
            BEGIN
                INSERT INTO `stock`
                SET
                    `id` = UUID_TO_BIN(UUID()),
                    `productId` = `productId`,
                    `storageId` = `storageId`,
                    `value` = GET_MANDATORY_DECIMAL(`data`, '$.delta');
            END;

            SELECT `stock`.`id`
            INTO `id`
            FROM `stock`
            WHERE
                `stock`.`productId` = `productId`
                AND
                `stock`.`storageId` = `storageId`
            FOR UPDATE;

            UPDATE `stock`
            SET `value` = `stock`.`value` + GET_MANDATORY_DECIMAL(`data`, '$.delta')
            WHERE `stock`.`id` = `id`;
        END;
    END;
END$$



CREATE PROCEDURE `API_USER_STORAGE_DELETE`
(
    IN `invoker` TEXT,
    IN `data` JSON
)
MODIFIES SQL DATA
SQL SECURITY INVOKER
BEGIN
    CALL SET_USER_CONTEXT(`invoker`);
    CALL ENSURE_JSON_TYPE(`data`, 'OBJECT');

    BEGIN
        DECLARE `id` BINARY(16) DEFAULT GET_MANDATORY_ID(`data`, '$.id');
        DECLARE EXIT HANDLER FOR SQLWARNING,SQLEXCEPTION
        BEGIN
            ROLLBACK;
            RESIGNAL;
        END;

        START TRANSACTION;

        DELETE FROM `stock`
        WHERE `stock`.`storageId` = `id`;

        DELETE FROM `storagePermission`
        WHERE `storagePermission`.`storageId` = `id`;

        DELETE FROM `storage`
        WHERE `storage`.`id` = `id`;

        IF ROW_COUNT() = 0 THEN
            SIGNAL SQLSTATE '45404' SET MESSAGE_TEXT = 'storage not found or already deleted';
        END IF;

        COMMIT;
    END;
END$$



CREATE PROCEDURE `API_USER_STORAGE_POST`
(
    IN `invoker` TEXT,
    IN `data` JSON
)
MODIFIES SQL DATA
SQL SECURITY INVOKER
BEGIN
    CALL SET_USER_CONTEXT(`invoker`);
    CALL ENSURE_JSON_TYPE(`data`, 'OBJECT');

    BEGIN
        DECLARE `id` BINARY(16);
        DECLARE CONTINUE HANDLER FOR NOT FOUND
        BEGIN
            SIGNAL SQLSTATE '45404' SET MESSAGE_TEXT = 'storage not found';
        END;

        SELECT `storage`.`id`
        INTO `id`
        FROM `storage`
        WHERE `storage`.`id` = GET_MANDATORY_ID(`data`, '$.id')
        FOR UPDATE;

        UPDATE `storage`
        SET
            `name` = CASE WHEN JSON_CONTAINS_PATH(`data`, 'all', '$.name')
                THEN GET_MANDATORY_STRING(`data`, '$.name')
                ELSE `storage`.`name`
            END,
            `active` = CASE WHEN JSON_CONTAINS_PATH(`data`, 'all', '$.active')
                THEN GET_BOOLEAN(`data`, '$.active')
                ELSE `storage`.`active`
            END
        WHERE `storage`.`id` = `id`;
    END;
END$$



CREATE PROCEDURE `API_USER_STORAGE_PUT`
(
    IN `invoker` TEXT,
    IN `data` JSON
)
MODIFIES SQL DATA
SQL SECURITY INVOKER
BEGIN
    CALL SET_USER_CONTEXT(`invoker`);
    CALL ENSURE_JSON_TYPE(`data`, 'OBJECT');
    CALL ENSURE_EMPTY_ID(`data`, '$.id');

    INSERT INTO `storage`
    SET
        `id` = UUID_TO_BIN(UUID()),
        `name` = CASE WHEN JSON_CONTAINS_PATH(`data`, 'all', '$.name')
            THEN GET_MANDATORY_STRING(`data`, '$.name')
            ELSE ''
        END,
        `active` = CASE WHEN JSON_CONTAINS_PATH(`data`, 'all', '$.active')
            THEN GET_BOOLEAN(`data`, '$.active')
            ELSE TRUE
        END;
END$$



CREATE PROCEDURE `API_USER_STORAGEPERMISSION_DELETE`
(
    IN `invoker` TEXT,
    IN `data` JSON
)
MODIFIES SQL DATA
SQL SECURITY INVOKER
BEGIN
    CALL SET_USER_CONTEXT(`invoker`);
    CALL ENSURE_JSON_TYPE(`data`, 'OBJECT');

    DELETE FROM `storagePermission`
    WHERE
        `storagePermission`.`storageId` <=> GET_OPTIONAL_ID(`data`, '$.storageId')
        AND
        `storagePermission`.`userId` = GET_MANDATORY_ID(`data`, '$.userId');
END$$



CREATE PROCEDURE `API_USER_STORAGEPERMISSION_PUT`
(
    IN `invoker` TEXT,
    IN `data` JSON
)
MODIFIES SQL DATA
SQL SECURITY INVOKER
BEGIN
    CALL SET_USER_CONTEXT(`invoker`);
    CALL ENSURE_JSON_TYPE(`data`, 'OBJECT');

    BEGIN
        DECLARE `id` BINARY(16);
        DECLARE `storageId` BINARY(16) DEFAULT GET_OPTIONAL_ID(`data`, '$.storageId');
        DECLARE `userId` BINARY(16) DEFAULT GET_MANDATORY_ID(`data`, '$.userId');
        DECLARE EXIT HANDLER FOR NOT FOUND
        BEGIN
            INSERT INTO `storagePermission`
            SET
                `id` = UUID_TO_BIN(UUID()),
                `storageId` = `storageId`,
                `userId` = `userId`,
                `stock` = CASE WHEN JSON_CONTAINS_PATH(`data`, 'all', '$.stock')
                    THEN GET_BOOLEAN(`data`, '$.stock')
                    ELSE FALSE
                END;
        END;

        SELECT `storagePermission`.`id`
        INTO `id`
        FROM `storagePermission`
        WHERE
            `storagePermission`.`storageId` <=> `storageId`
            AND
            `storagePermission`.`userId` = `userId`
        FOR UPDATE;

        UPDATE `storagePermission`
        SET `stock` = CASE WHEN JSON_CONTAINS_PATH(`data`, 'all', '$.stock')
            THEN GET_BOOLEAN(`data`, '$.stock')
            ELSE `storagePermission`.`stock`
        END
        WHERE `storagePermission`.`id` = `id`;
    END;
END$$



CREATE PROCEDURE `API_SYSTEM_SYNC_START`
()
READS SQL DATA
SQL SECURITY INVOKER
BEGIN
    CALL SET_SYSTEM_CONTEXT();

    IF @syncRevision IS NOT NULL THEN
        SIGNAL SQLSTATE '45500' SET MESSAGE_TEXT = 'sync already started';
    END IF;

    SET @syncRevision = CURRENT_REVISION();
END$$



CREATE PROCEDURE `API_SYSTEM_SYNC`
(
    IN `type` ENUM('product', 'productGroup'),
    IN `data` JSON
)
MODIFIES SQL DATA
SQL SECURITY INVOKER
BEGIN
    CALL SET_SYSTEM_CONTEXT();
    CALL ENSURE_JSON_TYPE(`data`, 'ARRAY');

    IF @syncRevision IS NULL THEN
        SIGNAL SQLSTATE '45500' SET MESSAGE_TEXT = 'sync not started';
    END IF;

    BEGIN
        DECLARE `obj` JSON;
        DECLARE `objs` CURSOR FOR SELECT * FROM JSON_TABLE
        (
            `data`, '$[*]' COLUMNS(`obj` JSON PATH '$')
        ) AS `objs`;
        DECLARE EXIT HANDLER FOR NOT FOUND BEGIN END;

        OPEN `objs`;

        LOOP
            FETCH `objs` INTO `obj`;
            CALL ENSURE_JSON_TYPE(`obj`, 'OBJECT');
            CASE `type`
                WHEN 'product' THEN CALL INSERT_OR_UPDATE_PRODUCT(`obj`);
                WHEN 'productGroup' THEN CALL INSERT_OR_UPDATE_PRODUCTGROUP(`obj`);
                ELSE SIGNAL SQLSTATE '45400' SET MESSAGE_TEXT = 'invalid object type';
            END CASE;
        END LOOP;
    END;
END$$



CREATE PROCEDURE `API_SYSTEM_SYNC_END`
()
MODIFIES SQL DATA
SQL SECURITY INVOKER
BEGIN
    CALL SET_SYSTEM_CONTEXT();

    IF @syncRevision IS NULL THEN
        SIGNAL SQLSTATE '45500' SET MESSAGE_TEXT = 'sync not started';
    END IF;

    BEGIN
        DECLARE `revision` BIGINT UNSIGNED DEFAULT @syncRevision;

        SET @syncRevision = NULL;

        CALL DELETE_PRODUCT(NULL, `revision`);
        CALL DELETE_PRODUCTGROUP(NULL, `revision`);
    END;
END$$



CREATE PROCEDURE `API_SYSTEM_WEBHOOK`
(
    IN `data` JSON
)
MODIFIES SQL DATA
SQL SECURITY INVOKER
BEGIN
    CALL SET_SYSTEM_CONTEXT();
    CALL ENSURE_JSON_TYPE(`data`, 'OBJECT');

    IF JSON_CONTAINS_PATH(`data`, 'all', '$.product_id') THEN
        IF JSON_LENGTH(JSON_KEYS(`data`)) = 1 THEN
            CALL DELETE_PRODUCT
            (
                (
                    SELECT `product`.`id`
                    FROM `product`
                    WHERE `product`.`api_id` = GET_MANDATORY_BIGINT(`data`, '$.product_id')
                ),
                NULL
            );
        ELSE
            CALL INSERT_OR_UPDATE_PRODUCT(`data`);
        END IF;
    ELSEIF JSON_CONTAINS_PATH(`data`, 'all', '$.productgroup_id') THEN
        IF JSON_LENGTH(JSON_KEYS(`data`)) = 1 THEN
            CALL DELETE_PRODUCTGROUP
            (
                (
                    SELECT `productGroup`.`id`
                    FROM `productGroup`
                    WHERE `productGroup`.`api_id` = GET_MANDATORY_BIGINT(`data`, '$.productgroup_id')
                ),
                NULL
            );
        ELSE
            CALL INSERT_OR_UPDATE_PRODUCTGROUP(`data`);
        END IF;
    ELSE
        SIGNAL SQLSTATE '45400' SET MESSAGE_TEXT = 'unknown data type';
    END IF;
END$$



CREATE FUNCTION `CAN_ADD_PRODUCT`
(
    `groupId` BINARY(16)
)
RETURNS BOOLEAN
READS SQL DATA
SQL SECURITY INVOKER
BEGIN
    RETURN EXISTS
    (
        SELECT *
        FROM `effectiveProductPermission`
        WHERE
            `effectiveProductPermission`.`groupId` <=> `groupId`
            AND
            `effectiveProductPermission`.`userId` = @currentUserId
            AND
            `effectiveProductPermission`.`add`
    );
END$$



CREATE FUNCTION `CAN_REMOVE_PRODUCT`
(
    `groupId` BINARY(16)
)
RETURNS BOOLEAN
READS SQL DATA
SQL SECURITY INVOKER
BEGIN
    RETURN EXISTS
    (
        SELECT *
        FROM `effectiveProductPermission`
        WHERE
            `effectiveProductPermission`.`groupId` <=> `groupId`
            AND
            `effectiveProductPermission`.`userId` = @currentUserId
            AND
            `effectiveProductPermission`.`remove`
    );
END$$



CREATE FUNCTION `CURRENT_REVISION`
()
RETURNS BIGINT UNSIGNED
READS SQL DATA
SQL SECURITY INVOKER
BEGIN
    RETURN IFNULL
    (
        (
            SELECT MAX(`changelog`.`revision`)
            FROM `changelog`
        ),
        0
    );
END$$



CREATE PROCEDURE `DELETE_PRODUCT`
(
    IN `id` BINARY(16),
    IN `revision` BIGINT UNSIGNED
)
MODIFIES SQL DATA
SQL SECURITY INVOKER
BEGIN
    DECLARE EXIT HANDLER FOR SQLWARNING,SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    DELETE FROM `stock`
    WHERE
        (`id` IS NOT NULL AND `stock`.`productId` = `id`)
        OR
        (
            `revision` IS NOT NULL AND `stock`.`productId` IN
            (
                SELECT `product`.`id`
                FROM `product`
                WHERE `product`.`revision` < `revision`
            )
        );

    DELETE FROM `product`
    WHERE
        (`id` IS NOT NULL AND `product`.`id` = `id`)
        OR
        (`revision` IS NOT NULL AND `product`.`revision` < `revision`);

    COMMIT;
END$$



CREATE PROCEDURE `DELETE_PRODUCTGROUP`
(
    IN `id` BINARY(16),
    IN `revision` BIGINT UNSIGNED
)
MODIFIES SQL DATA
SQL SECURITY INVOKER
BEGIN
    DECLARE EXIT HANDLER FOR SQLWARNING,SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    UPDATE `product`
    SET `product`.`groupId` = NULL
    WHERE
        (`id` IS NOT NULL AND `product`.`groupId` = `id`)
        OR
        (
            `revision` IS NOT NULL AND `product`.`groupId` IN
            (
                SELECT `productGroup`.`id`
                FROM `productGroup`
                WHERE `productGroup`.`revision` < `revision`
            )
        );

    UPDATE `productGroup`
    SET `productGroup`.`parentId` = NULL
    WHERE
        (`id` IS NOT NULL AND `productGroup`.`parentId` = `id`)
        OR
        (
            `revision` IS NOT NULL AND `productGroup`.`parentId` IN
            (
                SELECT `parent`.`id`
                FROM (SELECT * FROM `productGroup`) AS `parent`
                WHERE `parent`.`revision` < `revision`
            )
        );

    DELETE FROM `productPermission`
    WHERE
        (`id` IS NOT NULL AND `productPermission`.`groupId` = `id`)
        OR
        (
            `revision` IS NOT NULL AND `productPermission`.`groupId` IN
            (
                SELECT `productGroup`.`id`
                FROM `productGroup`
                WHERE `productGroup`.`revision` < `revision`
            )
        );

    DELETE FROM `productGroup`
    WHERE
        (`id` IS NOT NULL AND `productGroup`.`id` = `id`)
        OR
        (`revision` IS NOT NULL AND `productGroup`.`revision` < `revision`);

    COMMIT;
END$$



CREATE PROCEDURE `ENSURE_EMPTY_ID`
(
    IN `data` JSON,
    IN `path` LONGTEXT
)
DETERMINISTIC
SQL SECURITY INVOKER
BEGIN
    IF GET_OPTIONAL_ID(`data`, `path`) IS NOT NULL THEN
        SET @message = CONCAT(`path`, 'must be "*"');
        SIGNAL SQLSTATE '45400' SET MESSAGE_TEXT = @message;
    END IF;
END$$



CREATE PROCEDURE `ENSURE_JSON_TYPE`
(
    IN `data` JSON,
    IN `type` ENUM('ARRAY', 'OBJECT')
)
DETERMINISTIC
SQL SECURITY INVOKER
BEGIN
    IF `data` IS NULL THEN
        SIGNAL SQLSTATE '45400' SET MESSAGE_TEXT = 'missing input data';
    END IF;

    IF JSON_TYPE(`data`) <> `type` THEN
        SET @message = CONCAT(`type`, ' input data expected');
        SIGNAL SQLSTATE '45400' SET MESSAGE_TEXT = @message;
    END IF;
END$$



CREATE PROCEDURE `ENSURE_PRODUCT_API_SUCCESS_AND_METHOD`
(
    IN `data` JSON,
    IN `method` ENUM('PUT', 'POST', 'DELETE')
)
SQL SECURITY INVOKER
BEGIN
    IF NOT @productMethod <=> `method` THEN
        SET @message = CONCAT(`method`, ' not started');
        SIGNAL SQLSTATE '45500' SET MESSAGE_TEXT = @message;
    END IF;

    SET @productMethod = NULL;

    IF NOT JSON_TYPE(`data`) <=> 'OBJECT' THEN
        SIGNAL SQLSTATE '45500' SET MESSAGE_TEXT = 'object result expected';
    END IF;

    IF `data`->'$.error' = TRUE THEN
        SET @message = CASE WHEN JSON_TYPE(`data`->'$.msg') <=> 'STRING'
            THEN SUBSTRING(`data`->>'$.msg', 1, 128)
            ELSE 'unknown ready2order error'
        END;
        SIGNAL SQLSTATE '45500' SET MESSAGE_TEXT = @message;
    END IF;
END$$



CREATE PROCEDURE `ENSURE_PRODUCT_PROPERTIES`
(
    IN `groupId` BINARY(16),
    IN `data` JSON
)
READS SQL DATA
SQL SECURITY INVOKER
BEGIN
    DECLARE `properties` LONGTEXT DEFAULT
    (
        SELECT GROUP_CONCAT(DISTINCT `obj`.`key`)
        FROM JSON_TABLE(JSON_KEYS(`data`), '$[*]' COLUMNS(`key` LONGTEXT PATH '$')) AS `obj`
        WHERE `obj`.`key` NOT IN ('id', 'groupId') AND NOT EXISTS
        (
            SELECT *
            FROM `effectiveProductPermission`
            WHERE
                `effectiveProductPermission`.`groupId` <=> `groupId`
                AND
                `effectiveProductPermission`.`userId` = @currentUserId
                AND
                FIND_IN_SET(`obj`.`key`, `effectiveProductPermission`.`properties`) > 0
        )
    );

    IF `properties` IS NOT NULL THEN
        SET @message = SUBSTRING(CONCAT('properties not allowed: ', `properties`), 1, 128);
        SIGNAL SQLSTATE '45403' SET MESSAGE_TEXT = @message;
    END IF;
END$$



CREATE FUNCTION `GET_BOOLEAN`
(
    `json_doc` JSON,
    `path` LONGTEXT
)
RETURNS BOOLEAN
DETERMINISTIC
SQL SECURITY INVOKER
BEGIN
    DECLARE `value` JSON DEFAULT GET_OPTIONAL(`json_doc`, `path`);

    IF `value` IS NULL THEN
        SET @message = CONCAT(`path`, ' expected boolean, got null');
        SIGNAL SQLSTATE '45400' SET MESSAGE_TEXT = @message;
    END IF;

    BEGIN
        DECLARE CONTINUE HANDLER FOR SQLWARNING,SQLEXCEPTION
        BEGIN
            SET @message = CONCAT(`path`, ' is not a boolean');
            SIGNAL SQLSTATE '45400' SET MESSAGE_TEXT = @message;
        END;
        RETURN `value`;
    END;
END$$



CREATE FUNCTION `GET_DATETIME`
(
    `json_doc` JSON,
    `path` LONGTEXT
)
RETURNS DATETIME
DETERMINISTIC
SQL SECURITY INVOKER
BEGIN
    DECLARE `value` JSON DEFAULT GET_OPTIONAL(`json_doc`, `path`);

    IF `value` IS NULL THEN
        SET @message = CONCAT(`path`, ' expected datetime, got null');
        SIGNAL SQLSTATE '45400' SET MESSAGE_TEXT = @message;
    END IF;

    BEGIN
        DECLARE CONTINUE HANDLER FOR SQLWARNING,SQLEXCEPTION
        BEGIN
            SET @message = CONCAT(`path`, ' is not a datetime');
            SIGNAL SQLSTATE '45400' SET MESSAGE_TEXT = @message;
        END;
        RETURN `value`;
    END;
END$$



CREATE FUNCTION `GET_LOG_UPDATES`
(
    `table` VARCHAR(64),
    `key` BINARY(16),
    `firstRevision` BIGINT UNSIGNED,
    `lastRevision` BIGINT UNSIGNED
)
RETURNS JSON
READS SQL DATA
SQL SECURITY INVOKER
BEGIN
    DECLARE `mods` JSON DEFAULT JSON_OBJECT();
    DECLARE `update` JSON;
    DECLARE `updates` CURSOR FOR
        SELECT JSON_EXTRACT(`changelog`.`change`, '$.mods')
        FROM `changelog`
        WHERE
            `changelog`.`table` = `table`
            AND
            `changelog`.`key` = `key`
            AND
            `changelog`.`type` = 2
            AND
            `changelog`.`revision` BETWEEN `firstRevision` AND `lastRevision`
        ORDER BY `changelog`.`revision`;
    DECLARE CONTINUE HANDLER FOR NOT FOUND RETURN `mods`;

    OPEN `updates`;

    LOOP
        FETCH `updates` INTO `update`;
        SET `mods` = MERGE_UPDATES(`mods`, `update`);
    END LOOP;
END$$



CREATE FUNCTION `GET_MANDATORY_BIGINT`
(
    `json_doc` JSON,
    `path` LONGTEXT
)
RETURNS BIGINT
DETERMINISTIC
SQL SECURITY INVOKER
BEGIN
    DECLARE `value` BIGINT DEFAULT GET_OPTIONAL_BIGINT(`json_doc`, `path`);
    IF `value` IS NULL THEN
        SET @message = CONCAT(`path`, ' expected integer, got null');
        SIGNAL SQLSTATE '45400' SET MESSAGE_TEXT = @message;
    END IF;
    RETURN `value`;
END$$



CREATE FUNCTION `GET_MANDATORY_DECIMAL`
(
    `json_doc` JSON,
    `path` LONGTEXT
)
RETURNS DECIMAL(20,5)
DETERMINISTIC
SQL SECURITY INVOKER
BEGIN
    DECLARE `value` DECIMAL(20,5) DEFAULT GET_OPTIONAL_DECIMAL(`json_doc`, `path`);
    IF `value` IS NULL THEN
        SET @message = CONCAT(`path`, ' expected decimal, got null');
        SIGNAL SQLSTATE '45400' SET MESSAGE_TEXT = @message;
    END IF;
    RETURN `value`;
END$$



CREATE FUNCTION `GET_MANDATORY_ID`
(
    `json_doc` JSON,
    `path` LONGTEXT
)
RETURNS BINARY(16)
DETERMINISTIC
SQL SECURITY INVOKER
BEGIN
    DECLARE `value` BINARY(16) DEFAULT GET_OPTIONAL_ID(`json_doc`, `path`);
    IF `value` IS NULL THEN
        SET @message = CONCAT(`path`, ' expected UUID, got "*"');
        SIGNAL SQLSTATE '45400' SET MESSAGE_TEXT = @message;
    END IF;
    RETURN `value`;
END$$



CREATE FUNCTION `GET_MANDATORY_STRING`
(
    `json_doc` JSON,
    `path` LONGTEXT
)
RETURNS LONGTEXT
DETERMINISTIC
SQL SECURITY INVOKER
BEGIN
    DECLARE `value` LONGTEXT DEFAULT GET_OPTIONAL_STRING(`json_doc`, `path`);
    IF `value` IS NULL THEN
        SET @message = CONCAT(`path`, ' expected string, got null');
        SIGNAL SQLSTATE '45400' SET MESSAGE_TEXT = @message;
    END IF;
    RETURN `value`;
END$$



CREATE FUNCTION `GET_OPTIONAL`
(
    `json_doc` JSON,
    `path` LONGTEXT
)
RETURNS JSON
DETERMINISTIC
SQL SECURITY INVOKER
BEGIN
    DECLARE `value` JSON DEFAULT JSON_EXTRACT(`json_doc`, `path`);

    IF `value` IS NULL THEN
        SET @message = CONCAT(`path`, ' is missing');
        SIGNAL SQLSTATE '45400' SET MESSAGE_TEXT = @message;
    END IF;

    IF JSON_TYPE(`value`) = 'NULL' THEN
        RETURN NULL;
    END IF;

    RETURN `value`;
END$$



CREATE FUNCTION `GET_OPTIONAL_BIGINT`
(
    `json_doc` JSON,
    `path` LONGTEXT
)
RETURNS BIGINT
DETERMINISTIC
SQL SECURITY INVOKER
BEGIN
    DECLARE `value` JSON DEFAULT GET_OPTIONAL(`json_doc`, `path`);
    DECLARE CONTINUE HANDLER FOR SQLWARNING,SQLEXCEPTION
    BEGIN
        SET @message = CONCAT(`path`, ' is not a valid integer');
        SIGNAL SQLSTATE '45400' SET MESSAGE_TEXT = @message;
    END;
    RETURN `value`;
END$$



CREATE FUNCTION `GET_OPTIONAL_DECIMAL`
(
    `json_doc` JSON,
    `path` LONGTEXT
)
RETURNS DECIMAL(20,5)
DETERMINISTIC
SQL SECURITY INVOKER
BEGIN
    DECLARE `value` JSON DEFAULT GET_OPTIONAL(`json_doc`, `path`);
    DECLARE CONTINUE HANDLER FOR SQLWARNING,SQLEXCEPTION
    BEGIN
        SET @message = CONCAT(`path`, ' is not a valid decimal');
        SIGNAL SQLSTATE '45400' SET MESSAGE_TEXT = @message;
    END;
    RETURN `value`;
END$$



CREATE FUNCTION `GET_OPTIONAL_ID`
(
    `json_doc` JSON,
    `path` LONGTEXT
)
RETURNS BINARY(16)
DETERMINISTIC
SQL SECURITY INVOKER
BEGIN
    DECLARE `value` JSON DEFAULT GET_OPTIONAL(`json_doc`, `path`);
    DECLARE CONTINUE HANDLER FOR SQLWARNING,SQLEXCEPTION
    BEGIN
        SET @message = CONCAT(`path`, ' is not a valid UUID');
        SIGNAL SQLSTATE '45400' SET MESSAGE_TEXT = @message;
    END;

    IF `value` IS NULL THEN
        SET @message = CONCAT(`path`, ' expected UUID, got null');
        SIGNAL SQLSTATE '45400' SET MESSAGE_TEXT = @message;
    END IF;

    IF (JSON_UNQUOTE(`value`) = '*') THEN
        RETURN NULL;
    END IF;

    RETURN UUID_TO_BIN(JSON_UNQUOTE(`value`));
END$$



CREATE FUNCTION `GET_OPTIONAL_STRING`
(
    `json_doc` JSON,
    `path` LONGTEXT
)
RETURNS LONGTEXT
DETERMINISTIC
SQL SECURITY INVOKER
BEGIN
    DECLARE `value` JSON DEFAULT GET_OPTIONAL(`json_doc`, `path`);
    DECLARE CONTINUE HANDLER FOR SQLWARNING,SQLEXCEPTION
    BEGIN
        SET @message = CONCAT(`path`, ' is not a string');
        SIGNAL SQLSTATE '45400' SET MESSAGE_TEXT = @message;
    END;
    RETURN JSON_UNQUOTE(`value`);
END$$



CREATE PROCEDURE `INSERT_OR_UPDATE_PRODUCT`
(
    IN `data` JSON
)
MODIFIES SQL DATA
SQL SECURITY INVOKER
BEGIN

    DECLARE `api_id` BIGINT DEFAULT GET_MANDATORY_BIGINT(`data`, '$.product_id');

    BEGIN
        DECLARE `id` BINARY(16);
        DECLARE `api_groupId` BIGINT DEFAULT CASE
            WHEN JSON_CONTAINS_PATH(`data`, 'all', '$.productgroup.productgroup_id')
                THEN GET_OPTIONAL_BIGINT(`data`, '$.productgroup.productgroup_id')
            WHEN JSON_CONTAINS_PATH(`data`, 'all', '$.productgroup_id')
                THEN GET_OPTIONAL_BIGINT(`data`, '$.productgroup_id')
            ELSE
                NULL
        END;
        DECLARE `groupId` BINARY(16) DEFAULT
        (
            SELECT `productGroup`.`id`
            FROM `productGroup`
            WHERE `productGroup`.`api_id` = `api_groupId`
        );
        DECLARE EXIT HANDLER FOR NOT FOUND
        BEGIN
            INSERT INTO `product`
            SET
                `id` = UUID_TO_BIN(UUID()),
                `groupId` = `groupId`,
                `externalReference` = GET_OPTIONAL_STRING(`data`, '$.product_externalReference'),
                `itemNumber` = GET_OPTIONAL_STRING(`data`, '$.product_itemnumber'),
                `barcode` = GET_OPTIONAL_STRING(`data`, '$.product_barcode'),
                `name` = GET_MANDATORY_STRING(`data`, '$.product_name'),
                `description` = GET_OPTIONAL_STRING(`data`, '$.product_description'),
                `price` = GET_MANDATORY_DECIMAL(`data`, '$.product_price'),
                `priceIncludesVat` = GET_BOOLEAN(`data`, '$.product_priceIncludesVat'),
                `vat` = GET_MANDATORY_DECIMAL(`data`, '$.product_vat'),
                `customPrice` = GET_BOOLEAN(`data`, '$.product_customPrice'),
                `customQuantity` = GET_BOOLEAN(`data`, '$.product_customQuantity'),
                `fav` = GET_BOOLEAN(`data`, '$.product_fav'),
                `highlight` = GET_BOOLEAN(`data`, '$.product_highlight'),
                `expressMode` = GET_BOOLEAN(`data`, '$.product_expressMode'),
                `stockEnabled` = GET_BOOLEAN(`data`, '$.product_stock_enabled'),
                `ingredientsEnabled` = GET_BOOLEAN(`data`, '$.product_ingredients_enabled'),
                `variationsEnabled` = GET_BOOLEAN(`data`, '$.product_variations_enabled'),
                `stockValue` = GET_MANDATORY_DECIMAL(`data`, '$.product_stock_value'),
                `stockUnit` = GET_OPTIONAL_STRING(`data`, '$.product_stock_unit'),
                `stockReorderLevel` = GET_OPTIONAL_DECIMAL(`data`, '$.product_stock_reorderLevel'),
                `stockSafetyStock` = GET_OPTIONAL_DECIMAL(`data`, '$.product_stock_safetyStock'),
                `sortIndex` = GET_MANDATORY_BIGINT(`data`, '$.product_sortIndex'),
                `active` = GET_BOOLEAN(`data`, '$.product_active'),
                `soldOut` = GET_BOOLEAN(`data`, '$.product_soldOut'),
                `sideDishOrder` = GET_BOOLEAN(`data`, '$.product_sideDishOrder'),
                `discountable` = GET_BOOLEAN(`data`, '$.product_discountable'),
                `accountingCode` = GET_OPTIONAL_STRING(`data`, '$.product_accountingCode'),
                `colorClass` = GET_OPTIONAL_STRING(`data`, '$.product_colorClass'),
                `typeId` = GET_OPTIONAL_BIGINT(`data`, '$.product_type_id'),
                `createdAt` = GET_DATETIME(`data`, '$.product_created_at'),
                `updatedAt` = GET_DATETIME(`data`, '$.product_updated_at'),
                `alternativeNameOnReceipts` = GET_OPTIONAL_STRING(`data`, '$.product_alternativeNameOnReceipts'),
                `alternativeNameInPos` = GET_OPTIONAL_STRING(`data`, '$.product_alternativeNameInPos'),
                `productionCosts` = CASE WHEN @setProductionCosts THEN @productionCosts ELSE NULL END,
                `revision` = CURRENT_REVISION(),
                `api_id` = `api_id`,
                `api_groupId` = `api_groupId`;
        END;

        SELECT `product`.`id`
        INTO `id`
        FROM `product`
        WHERE `product`.`api_id` = `api_id`
        FOR UPDATE;

        UPDATE `product`
        SET
            #id
            `groupId` = `groupId`,
            `externalReference` = GET_OPTIONAL_STRING(`data`, '$.product_externalReference'),
            `itemNumber` = GET_OPTIONAL_STRING(`data`, '$.product_itemnumber'),
            `barcode` = GET_OPTIONAL_STRING(`data`, '$.product_barcode'),
            `name` = GET_MANDATORY_STRING(`data`, '$.product_name'),
            `description` = GET_OPTIONAL_STRING(`data`, '$.product_description'),
            `price` = GET_MANDATORY_DECIMAL(`data`, '$.product_price'),
            `priceIncludesVat` = GET_BOOLEAN(`data`, '$.product_priceIncludesVat'),
            `vat` = GET_MANDATORY_DECIMAL(`data`, '$.product_vat'),
            `customPrice` = GET_BOOLEAN(`data`, '$.product_customPrice'),
            `customQuantity` = GET_BOOLEAN(`data`, '$.product_customQuantity'),
            `fav` = GET_BOOLEAN(`data`, '$.product_fav'),
            `highlight` = GET_BOOLEAN(`data`, '$.product_highlight'),
            `expressMode` = GET_BOOLEAN(`data`, '$.product_expressMode'),
            `stockEnabled` = GET_BOOLEAN(`data`, '$.product_stock_enabled'),
            `ingredientsEnabled` = GET_BOOLEAN(`data`, '$.product_ingredients_enabled'),
            `variationsEnabled` = GET_BOOLEAN(`data`, '$.product_variations_enabled'),
            `stockValue` = GET_MANDATORY_DECIMAL(`data`, '$.product_stock_value'),
            `stockUnit` = GET_OPTIONAL_STRING(`data`, '$.product_stock_unit'),
            `stockReorderLevel` = GET_OPTIONAL_DECIMAL(`data`, '$.product_stock_reorderLevel'),
            `stockSafetyStock` = GET_OPTIONAL_DECIMAL(`data`, '$.product_stock_safetyStock'),
            `sortIndex` = GET_MANDATORY_BIGINT(`data`, '$.product_sortIndex'),
            `active` = GET_BOOLEAN(`data`, '$.product_active'),
            `soldOut` = GET_BOOLEAN(`data`, '$.product_soldOut'),
            `sideDishOrder` = GET_BOOLEAN(`data`, '$.product_sideDishOrder'),
            `discountable` = GET_BOOLEAN(`data`, '$.product_discountable'),
            `accountingCode` = GET_OPTIONAL_STRING(`data`, '$.product_accountingCode'),
            `colorClass` = GET_OPTIONAL_STRING(`data`, '$.product_colorClass'),
            `typeId` = GET_OPTIONAL_BIGINT(`data`, '$.product_type_id'),
            `createdAt` = GET_DATETIME(`data`, '$.product_created_at'),
            `updatedAt` = GET_DATETIME(`data`, '$.product_updated_at'),
            `alternativeNameOnReceipts` = GET_OPTIONAL_STRING(`data`, '$.product_alternativeNameOnReceipts'),
            `alternativeNameInPos` = GET_OPTIONAL_STRING(`data`, '$.product_alternativeNameInPos'),
            `productionCosts` = CASE WHEN @setProductionCosts THEN @productionCosts ELSE `product`.`productionCosts` END,
            `revision` = CURRENT_REVISION(),
            #api_id
            `api_groupId` = `api_groupId`
        WHERE `product`.`id` = `id`;
    END;

END$$



CREATE PROCEDURE `INSERT_OR_UPDATE_PRODUCTGROUP`
(
    IN `data` JSON
)
MODIFIES SQL DATA
SQL SECURITY INVOKER
BEGIN

    DECLARE `api_id` BIGINT DEFAULT GET_MANDATORY_BIGINT(`data`, '$.productgroup_id');

    BEGIN
        DECLARE `id` BINARY(16);
        DECLARE `api_parentId` BIGINT DEFAULT GET_OPTIONAL_BIGINT(`data`, '$.productgroup_parent');
        DECLARE `parentId` BINARY(16) DEFAULT
        (
            SELECT `productGroup`.`id`
            FROM `productGroup`
            WHERE `productGroup`.`api_id` = `api_parentId`
        );
        DECLARE EXIT HANDLER FOR NOT FOUND
        BEGIN
            SET `id` = UUID_TO_BIN(UUID());

            INSERT INTO `productGroup`
            SET
                `id` = `id`,
                `parentId` = `parentId`,
                `name` = GET_MANDATORY_STRING(`data`, '$.productgroup_name'),
                `description` = GET_OPTIONAL_STRING(`data`, '$.productgroup_description'),
                `shortcut` = GET_OPTIONAL_STRING(`data`, '$.productgroup_shortcut'),
                `active` = GET_BOOLEAN(`data`, '$.productgroup_active'),
                `sortIndex` = GET_MANDATORY_BIGINT(`data`, '$.productgroup_sortIndex'),
                `accountingCode` = GET_OPTIONAL_STRING(`data`, '$.productgroup_accountingCode'),
                `typeId` = GET_OPTIONAL_BIGINT(`data`, '$.productgroup_type_id'),
                `createdAt` = GET_DATETIME(`data`, '$.productgroup_created_at'),
                `updatedAt` = GET_DATETIME(`data`, '$.productgroup_updated_at'),
                `revision` = CURRENT_REVISION(),
                `api_id` = `api_id`,
                `api_parentId` = `api_parentId`;

            UPDATE `productGroup`
            SET `parentId` = `id`
            WHERE `productGroup`.`api_parentId` = `api_id`;

            UPDATE `product`
            SET `groupId` = `id`
            WHERE `product`.`api_groupId` = `api_id`;
        END;

        SELECT `productGroup`.`id`
        INTO `id`
        FROM `productGroup`
        WHERE `productGroup`.`api_id` = `api_id`
        FOR UPDATE;

        UPDATE `productGroup`
        SET
            #id
            `parentId` = `parentId`,
            `name` = GET_MANDATORY_STRING(`data`, '$.productgroup_name'),
            `description` = GET_OPTIONAL_STRING(`data`, '$.productgroup_description'),
            `shortcut` = GET_OPTIONAL_STRING(`data`, '$.productgroup_shortcut'),
            `active` = GET_BOOLEAN(`data`, '$.productgroup_active'),
            `sortIndex` = GET_MANDATORY_BIGINT(`data`, '$.productgroup_sortIndex'),
            `accountingCode` = GET_OPTIONAL_STRING(`data`, '$.productgroup_accountingCode'),
            `typeId` = GET_OPTIONAL_BIGINT(`data`, '$.productgroup_type_id'),
            `createdAt` = GET_DATETIME(`data`, '$.productgroup_created_at'),
            `updatedAt` = GET_DATETIME(`data`, '$.productgroup_updated_at'),
            `revision` = CURRENT_REVISION(),
            #api_id
            `api_parentId` = `api_parentId`
        WHERE `productGroup`.`id` = `id`;
    END;

END$$



CREATE PROCEDURE `LOG_DELETE`
(
    IN `table` VARCHAR(64),
    IN `key` BINARY(16)
)
MODIFIES SQL DATA
SQL SECURITY INVOKER
BEGIN
    INSERT INTO `changelog` (`id`, `userId`, `change`)
    VALUES
    (
        UUID_TO_BIN(UUID()),
        @currentUserId,
        JSON_OBJECT
        (
            'type', 3,
            'table', `table`,
            'key', BIN_TO_UUID(`key`)
        )
    );
END$$



CREATE PROCEDURE `LOG_INSERT`
(
    IN `table` VARCHAR(64),
    IN `key` BINARY(16),
    IN `obj` JSON
)
MODIFIES SQL DATA
SQL SECURITY INVOKER
BEGIN
    INSERT INTO `changelog` (`id`, `userId`, `change`)
    VALUES
    (
        UUID_TO_BIN(UUID()),
        @currentUserId,
        JSON_OBJECT
        (
            'type', 1,
            'table', `table`,
            'key', BIN_TO_UUID(`key`),
            'obj', `obj`
        )
    );
END$$



CREATE PROCEDURE `LOG_UPDATE`
(
    IN `table` VARCHAR(64),
    IN `old_key` BINARY(16),
    IN `old_obj` JSON,
    IN `new_key` BINARY(16),
    IN `new_obj` JSON
)
MODIFIES SQL DATA
SQL SECURITY INVOKER
BEGIN
    DECLARE `mods` JSON;

    IF NOT (`old_key` <=> `new_key`) THEN
        SIGNAL SQLSTATE '45500' SET MESSAGE_TEXT = 'key change detected';
    END IF;

    SELECT JSON_OBJECTAGG(`all_keys`.`key`, JSON_EXTRACT(`new_obj`, CONCAT('$.', `all_keys`.`key`)))
    INTO `mods`
    FROM
    (
        SELECT `old_keys`.`key` AS `key`
        FROM JSON_TABLE(JSON_KEYS(`old_obj`), '$[*]' COLUMNS (`key` LONGTEXT PATH '$')) AS `old_keys`
        UNION
        SELECT `new_keys`.`key` AS `key`
        FROM JSON_TABLE(JSON_KEYS(`new_obj`), '$[*]' COLUMNS (`key` LONGTEXT PATH '$')) AS `new_keys`
    ) AS `all_keys`
    WHERE NOT (JSON_EXTRACT(`old_obj`, CONCAT('$.', `all_keys`.`key`)) <=> JSON_EXTRACT(`new_obj`, CONCAT('$.', `all_keys`.`key`)));

    IF `mods` IS NOT NULL THEN
        INSERT INTO `changelog` (`id`, `userId`, `change`)
        VALUES
        (
            UUID_TO_BIN(UUID()),
            @currentUserId,
            JSON_OBJECT
            (
                'type', 2,
                'table', `table`,
                'key', BIN_TO_UUID(`new_key`),
                'mods', `mods`
            )
        );
    END IF;
END$$



CREATE FUNCTION `MERGE_UPDATES`
(
    `obj` JSON,
    `mods` JSON
)
RETURNS JSON
DETERMINISTIC
SQL SECURITY INVOKER
BEGIN
    DECLARE `key` LONGTEXT;
    DECLARE `keys` CURSOR FOR
        SELECT CONCAT('$.', `keysOfMods`.`key`) AS `key`
        FROM JSON_TABLE(JSON_KEYS(`mods`), '$[*]' COLUMNS(`key` LONGTEXT PATH '$')) AS `keysOfMods`;
    DECLARE CONTINUE HANDLER FOR NOT FOUND RETURN `obj`;

    OPEN `keys`;

    LOOP
        FETCH `keys` INTO `key`;
        SET `obj` = JSON_SET(`obj`, `key`, JSON_EXTRACT(`mods`, `key`));
    END LOOP;
END$$



CREATE PROCEDURE `PREPARE_PRODUCT_API_BODY`
(
    IN `data` JSON,
    OUT `body` JSON
)
READS SQL DATA
SQL SECURITY INVOKER
BEGIN
    SET `body` = IFNULL
    (
        (
            SELECT JSON_OBJECTAGG(
                CASE
                    WHEN `obj`.`key` = 'groupId' THEN 'productgroup_id'
                    WHEN `obj`.`key` LIKE 'stock%' THEN CONCAT('product_stock_', LOWER(SUBSTRING(`obj`.`key`, 6, 1)), SUBSTRING(`obj`.`key`, 7))
                    WHEN `obj`.`key` = 'itemNumber' THEN 'product_itemnumber'
                    ELSE CONCAT('product_', `obj`.`key`)
                END,
                CASE
                    WHEN `obj`.`key` = 'groupId' THEN
                    (
                        SELECT CAST(`productGroup`.`api_id` AS JSON)
                        FROM `productGroup`
                        WHERE `productGroup`.`id` = GET_OPTIONAL_ID(`data`, '$.groupId')
                    )
                    ELSE JSON_EXTRACT(`data`, CONCAT('$.', `obj`.`key`))
                END
            )
            FROM JSON_TABLE(JSON_KEYS(`data`), '$[*]' COLUMNS (`key` LONGTEXT PATH '$')) AS `obj`
            WHERE `obj`.`key` NOT IN
            (
                'id',
                'productionCost'
            )
        ),
        JSON_OBJECT()
    );
    SET @setProductionCosts = JSON_CONTAINS_PATH(`data`, 'all', '$.productionCosts');
    SET @productionCosts = CASE WHEN @setProductionCosts
        THEN GET_OPTIONAL_DECIMAL(`data`, '$.productionCosts')
        ELSE NULL
    END;
END$$



CREATE PROCEDURE `PREPARE_PRODUCT_API_URL`
(
    IN `id` BINARY(16),
    OUT `groupId` BINARY(16),
    OUT `uri` TEXT
)
READS SQL DATA
SQL SECURITY INVOKER
BEGIN
    DECLARE `product_id` BIGINT;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SIGNAL SQLSTATE '45404' SET MESSAGE_TEXT = 'product not found';

    SELECT
        `product`.`api_id`,
        `product`.`groupId`
    INTO
        `product_id`,
        `groupId`
    FROM `product`
    WHERE `product`.`id` = `id`
    FOR UPDATE;

    SET `uri` = CONCAT('/v1/products/', `product_id`);
END$$



CREATE PROCEDURE `SET_PRODUCT_API_METHOD`
(
    IN `method` ENUM('PUT', 'POST', 'DELETE')
)
READS SQL DATA
SQL SECURITY INVOKER
BEGIN
    IF @productMethod IS NOT NULL THEN
        SET @message = CONCAT(@productMethod, ' already started');
        SIGNAL SQLSTATE '45500' SET MESSAGE_TEXT = @message;
    END IF;
    SET @productMethod = `method`;
END$$



CREATE PROCEDURE `SET_SYSTEM_CONTEXT`
()
SQL SECURITY INVOKER
BEGIN
    DECLARE `systemId` BINARY(16) DEFAULT UNHEX('00000000000000000000000000000000');

    IF @currentUserId IS NOT NULL AND @currentUserId <> `systemId` THEN
        SIGNAL SQLSTATE '45500' SET MESSAGE_TEXT = 'switch from user to system context detected';
    END IF;
    SET @currentUserId = `systemId`;
END$$



CREATE PROCEDURE `SET_USER_CONTEXT`
(
    IN `invoker` TEXT
)
SQL SECURITY INVOKER
BEGIN
    DECLARE `systemId` BINARY(16) DEFAULT UNHEX('00000000000000000000000000000000');
    DECLARE `userId` BINARY(16);

    IF `invoker` IS NULL THEN
        SIGNAL SQLSTATE '45400' SET MESSAGE_TEXT = 'missing invoker parameter';
    END IF;
    IF NOT IS_UUID(`invoker`) THEN
        SIGNAL SQLSTATE '45400' SET MESSAGE_TEXT = 'invoker parameter must be an UUID.';
    END IF;
    SET `userId` = UUID_TO_BIN(`invoker`);
    IF `userId` = `systemId` THEN
        SIGNAL SQLSTATE '45400' SET MESSAGE_TEXT = 'invoker UUID must not be all zeroes';
    END IF;
    IF @currentUserId IS NOT NULL THEN
        IF @currentUserId = `systemId` THEN
            SIGNAL SQLSTATE '45500' SET MESSAGE_TEXT = 'switch from system to user context detected';
        END IF;
        IF @currentUserId <> `userId` THEN
            SIGNAL SQLSTATE '45500' SET MESSAGE_TEXT = 'user switch detected';
        END IF;
    END IF;
    SET @currentUserId = `userId`;
END$$



DELIMITER ;



CREATE TABLE `changelog`
(
    `id` BINARY(16) NOT NULL,
    `revision` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `userId` BINARY(16) NOT NULL,
    `change` JSON NOT NULL,
    `time` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `obj` JSON AS (JSON_OBJECT(
        'type', 1,
        'table', 'changelog',
        'key', BIN_TO_UUID(`id`),
        'obj', JSON_OBJECT(
            'id', BIN_TO_UUID(`id`),
            'userId', BIN_TO_UUID(`userId`),
            'change', `change`,
            'time', `time`
        )
    )) NOT NULL,
    `table` VARCHAR(64) AS (JSON_VALUE(`change`, '$.table' RETURNING CHAR(64) ERROR ON EMPTY ERROR ON ERROR)) NOT NULL,
    `key` BINARY(16) AS (UUID_TO_BIN(JSON_VALUE(`change`, '$.key' RETURNING CHAR(36) ERROR ON EMPTY ERROR ON ERROR))) NOT NULL,
    `type` TINYINT UNSIGNED AS (JSON_VALUE(`change`, '$.type' RETURNING UNSIGNED ERROR ON EMPTY ERROR ON ERROR)) NOT NULL,
    `uniqueId` BINARY(20) AS (CASE WHEN `type` = 1 THEN UNHEX(SHA1(CONCAT(`table`, '|', BIN_TO_UUID(`key`)))) ELSE NULL END) NULL,
    CONSTRAINT `revision` PRIMARY KEY (`revision`),
    CONSTRAINT `id` UNIQUE KEY (`id`),
    CONSTRAINT `uniqueId` UNIQUE KEY (`uniqueId`),
    INDEX `[table+key+type+revision]` (`table`, `key`, `type`, `revision`)
);



CREATE TABLE `productGroup`
(
    `id` BINARY(16) NOT NULL,
    `parentId` BINARY(16) NULL,
    `name` VARCHAR(255) NOT NULL,
    `description` VARCHAR(255) NULL,
    `shortcut` VARCHAR(20) NULL,
    `active` BOOLEAN NOT NULL,
    `sortIndex` BIGINT NOT NULL,
    `accountingCode` VARCHAR(50) NULL,
    `typeId` BIGINT NULL,
    `createdAt` DATETIME NOT NULL,
    `updatedAt` DATETIME NOT NULL,
    `obj` JSON AS (JSON_OBJECT(
        'id', BIN_TO_UUID(`id`),
        'parentId', IFNULL(BIN_TO_UUID(`parentId`), '*'),
        'name', `name`,
        'description', `description`,
        'shortcut', `shortcut`,
        'active', `active` IS TRUE,
        'sortIndex', `sortIndex`,
        'accountingCode', `accountingCode`,
        'typeId', `typeId`,
        'createdAt', `createdAt`,
        'updatedAt', `updatedAt`
    )) NOT NULL,
    `revision` BIGINT UNSIGNED NOT NULL,
    `api_id` BIGINT NOT NULL,
    `api_parentId` BIGINT NULL,
    CONSTRAINT `id` PRIMARY KEY (`id`),
    CONSTRAINT `api_id` UNIQUE KEY (`api_id`),
    INDEX `api_parentId` (`api_parentId`),
    INDEX `revision` (`revision`),
    INDEX `parentId` (`parentId`),
    CONSTRAINT `productGroup.parentId`
        FOREIGN KEY (`parentId`)
        REFERENCES `productGroup` (`id`)
        ON DELETE RESTRICT
        ON UPDATE RESTRICT
);

CREATE TRIGGER `productGroup_after_insert`
AFTER INSERT ON `productGroup`
FOR EACH ROW
CALL LOG_INSERT('productGroup', NEW.`id`, NEW.`obj`);

CREATE TRIGGER `productGroup_after_update`
AFTER UPDATE ON `productGroup`
FOR EACH ROW
CALL LOG_UPDATE('productGroup', OLD.`id`, OLD.`obj`, NEW.`id`, NEW.`obj`);

CREATE TRIGGER `productGroup_after_delete`
AFTER DELETE ON `productGroup`
FOR EACH ROW
CALL LOG_DELETE('productGroup', OLD.`id`);



CREATE TABLE `product`
(
    `id` BINARY(16) NOT NULL,
    `groupId` BINARY(16) NULL,
    `externalReference` VARCHAR(50) NULL,
    `itemNumber` VARCHAR(100) NULL,
    `barcode` VARCHAR(255) NULL,
    `name` VARCHAR(255) NOT NULL,
    `description` MEDIUMTEXT NULL,
    `price` DECIMAL(20,5) NOT NULL,
    `priceIncludesVat` BOOLEAN NOT NULL,
    `vat` DECIMAL(20,5) NOT NULL,
    `customPrice` BOOLEAN NOT NULL,
    `customQuantity` BOOLEAN NOT NULL,
    `fav` BOOLEAN NOT NULL,
    `highlight` BOOLEAN NOT NULL,
    `expressMode` BOOLEAN NOT NULL,
    `stockEnabled` BOOLEAN NOT NULL,
    `ingredientsEnabled` BOOLEAN NOT NULL,
    `variationsEnabled` BOOLEAN NOT NULL,
    `stockValue` DECIMAL(20,5) NOT NULL,
    `stockUnit` VARCHAR(50) NULL,
    `stockReorderLevel` DECIMAL(20,5) NULL,
    `stockSafetyStock` DECIMAL(20,5) NULL,
    `sortIndex` BIGINT NOT NULL,
    `active` BOOLEAN NOT NULL,
    `soldOut` BOOLEAN NOT NULL,
    `sideDishOrder` BOOLEAN NOT NULL,
    `discountable` BOOLEAN NOT NULL,
    `accountingCode` VARCHAR(50) NULL,
    `colorClass` VARCHAR(20) NULL,
    `typeId` BIGINT NULL,
    `createdAt` DATETIME NOT NULL,
    `updatedAt` DATETIME NOT NULL,
    `alternativeNameOnReceipts` VARCHAR(255) NULL,
    `alternativeNameInPos` VARCHAR(100) NULL,
    `productionCosts` DECIMAL(20,5) NULL,
    `obj` JSON AS (JSON_OBJECT(
        'id', BIN_TO_UUID(`id`),
        'groupId', IFNULL(BIN_TO_UUID(`groupId`), '*'),
        'externalReference', `externalReference`,
        'itemNumber', `itemNumber`,
        'barcode', `barcode`,
        'name', `name`,
        'description', `description`,
        'price', `price`,
        'priceIncludesVat', `priceIncludesVat` IS TRUE,
        'vat', `vat`,
        'customPrice', `customPrice` IS TRUE,
        'customQuantity', `customQuantity` IS TRUE,
        'fav', `fav` IS TRUE,
        'highlight', `highlight` IS TRUE,
        'expressMode', `expressMode` IS TRUE,
        'stockEnabled', `stockEnabled` IS TRUE,
        'ingredientsEnabled', `ingredientsEnabled` IS TRUE,
        'variationsEnabled', `variationsEnabled` IS TRUE,
        'stockValue', `stockValue`,
        'stockUnit', `stockUnit`,
        'stockReorderLevel', `stockReorderLevel`,
        'stockSafetyStock', `stockSafetyStock`,
        'sortIndex', `sortIndex`,
        'active', `active` IS TRUE,
        'soldOut', `soldOut` IS TRUE,
        'sideDishOrder', `sideDishOrder` IS TRUE,
        'discountable', `discountable` IS TRUE,
        'accountingCode', `accountingCode`,
        'colorClass', `colorClass`,
        'typeId', `typeId`,
        'createdAt', `createdAt`,
        'updatedAt', `updatedAt`,
        'alternativeNameOnReceipts', `alternativeNameOnReceipts`,
        'alternativeNameInPos', `alternativeNameInPos`,
        'productionCosts', `productionCosts`
    )) NOT NULL,
    `revision` BIGINT UNSIGNED NOT NULL,
    `api_id` BIGINT NOT NULL,
    `api_groupId` BIGINT NULL,
    CONSTRAINT `id` PRIMARY KEY (`id`),
    CONSTRAINT `api_id` UNIQUE KEY (`api_id`),
    INDEX `api_groupId` (`api_groupId`),
    INDEX `revision` (`revision`),
    INDEX `groupId` (`groupId`),
    CONSTRAINT `product.groupId`
        FOREIGN KEY (`groupId`)
        REFERENCES `productGroup` (`id`)
        ON DELETE RESTRICT
        ON UPDATE RESTRICT
);

CREATE TRIGGER `product_after_insert`
AFTER INSERT ON `product`
FOR EACH ROW
CALL LOG_INSERT('product', NEW.`id`, NEW.`obj`);

CREATE TRIGGER `product_after_update`
AFTER UPDATE ON `product`
FOR EACH ROW
CALL LOG_UPDATE('product', OLD.`id`, OLD.`obj`, NEW.`id`, NEW.`obj`);

CREATE TRIGGER `product_after_delete`
AFTER DELETE ON `product`
FOR EACH ROW
CALL LOG_DELETE('product', OLD.`id`);



CREATE TABLE `productPermission`
(
    `id` BINARY(16) NOT NULL,
    `groupId` BINARY(16) NULL,
    `userId` BINARY(16) NOT NULL,
    `add` BOOLEAN NOT NULL,
    `remove` BOOLEAN NOT NULL,
    `properties` SET
    (
        'externalReference',
        'itemNumber',
        'barcode',
        'name',
        'description',
        'price',
        'priceIncludesVat',
        'vat',
        'customPrice',
        'customQuantity',
        'fav',
        'highlight',
        'expressMode',
        'stockEnabled',
        'stockValue',
        'stockUnit',
        'stockReorderLevel',
        'stockSafetyStock',
        'active',
        'soldOut',
        'sideDishOrder',
        'discountable',
        'accountingCode',
        'type',
        'alternativeNameOnReceipts',
        'alternativeNameInPos',
        'productionCosts'
    ) NOT NULL,
    `obj` JSON AS (JSON_OBJECT(
        'id', BIN_TO_UUID(`id`),
        'groupId', IFNULL(BIN_TO_UUID(`groupId`), '*'),
        'userId', BIN_TO_UUID(`userId`),
        'add', `add` IS TRUE,
        'remove', `remove` IS TRUE,
        'properties', `properties`
    )) NOT NULL,
    CONSTRAINT `id` PRIMARY KEY (`id`),
    CONSTRAINT `[groupId+userId]` UNIQUE KEY (`groupId`, `userId`),
    CONSTRAINT `productPermission.groupId`
        FOREIGN KEY (`groupId`)
        REFERENCES `productGroup` (`id`)
        ON DELETE RESTRICT
        ON UPDATE RESTRICT
);

CREATE TRIGGER `productPermission_after_insert`
AFTER INSERT ON `productPermission`
FOR EACH ROW
CALL LOG_INSERT('productPermission', NEW.`id`, NEW.`obj`);

CREATE TRIGGER `productPermission_after_update`
AFTER UPDATE ON `productPermission`
FOR EACH ROW
CALL LOG_UPDATE('productPermission', OLD.`id`, OLD.`obj`, NEW.`id`, NEW.`obj`);

CREATE TRIGGER `productPermission_after_delete`
AFTER DELETE ON `productPermission`
FOR EACH ROW
CALL LOG_DELETE('productPermission', OLD.`id`);



CREATE VIEW `effectiveProductPermission`
(
    `groupId`,
    `userId`,
    `add`,
    `remove`,
    `properties`
)
AS
WITH RECURSIVE `cte` AS
(
    SELECT `productGroup`.`id` AS `id`, `productGroup`.`parentId` AS `parentId`
    FROM `productGroup`
    UNION ALL
    SELECT `cte`.`id` AS `id`, `productGroup`.`parentId` AS `parentId`
    FROM `cte` JOIN `productGroup`
    ON `cte`.`parentId` = `productGroup`.`id`
)
SELECT
    `all`.`groupId`,
    `productPermission`.`userId`,
    `productPermission`.`add`,
    `productPermission`.`remove`,
    `productPermission`.`properties`
FROM
(
    SELECT `cte`.`id` AS `groupId`, `cte`.`parentId` AS `parentId`
    FROM `cte`
    UNION ALL
    SELECT `productGroup`.`id` AS `groupId`, `productGroup`.`id` AS `parentId`
    FROM `productGroup`
    UNION ALL
    SELECT NULL AS `groupId`, NULL AS `parentId`
) AS `all`
JOIN `productPermission`
ON `all`.`parentId` <=> `productPermission`.`groupId`;



CREATE TABLE `storage`
(
    `id` BINARY(16) NOT NULL,
    `name` VARCHAR(255) COLLATE utf8mb4_0900_as_ci NOT NULL,
    `active` BOOLEAN NOT NULL,
    `obj` JSON AS (JSON_OBJECT(
        'id', BIN_TO_UUID(`id`),
        'name', `name`,
        'active', `active` IS TRUE
    )) NOT NULL,
    CONSTRAINT `id` PRIMARY KEY (`id`),
    CONSTRAINT `name` UNIQUE KEY (`name`),
    CONSTRAINT `storage.name`
        CHECK (`name` <> '' AND TRIM(`name`) = `name`)
);

CREATE TRIGGER `storage_after_insert`
AFTER INSERT ON `storage`
FOR EACH ROW
CALL LOG_INSERT('storage', NEW.`id`, NEW.`obj`);

CREATE TRIGGER `storage_after_update`
AFTER UPDATE ON `storage`
FOR EACH ROW
CALL LOG_UPDATE('storage', OLD.`id`, OLD.`obj`, NEW.`id`, NEW.`obj`);

CREATE TRIGGER `storage_after_delete`
AFTER DELETE ON `storage`
FOR EACH ROW
CALL LOG_DELETE('storage', OLD.`id`);



CREATE TABLE `storagePermission`
(
    `id` BINARY(16) NOT NULL,
    `storageId` BINARY(16) NULL,
    `userId` BINARY(16) NOT NULL,
    `stock` BOOLEAN NOT NULL,
    `obj` JSON AS (JSON_OBJECT(
        'id', BIN_TO_UUID(`id`),
        'storageId', IFNULL(BIN_TO_UUID(`storageId`), '*'),
        'userId', BIN_TO_UUID(`userId`),
        'stock', `stock` IS TRUE
    )) NOT NULL,
    CONSTRAINT `id` PRIMARY KEY (`id`),
    CONSTRAINT `[storageId+userId]` UNIQUE KEY (`storageId`, `userId`),
    CONSTRAINT `storagePermission.storageId`
        FOREIGN KEY (`storageId`)
        REFERENCES `storage` (`id`)
        ON DELETE RESTRICT
        ON UPDATE RESTRICT
);

CREATE TRIGGER `storagePermission_after_insert`
AFTER INSERT ON `storagePermission`
FOR EACH ROW
CALL LOG_INSERT('storagePermission', NEW.`id`, NEW.`obj`);

CREATE TRIGGER `storagePermission_after_update`
AFTER UPDATE ON `storagePermission`
FOR EACH ROW
CALL LOG_UPDATE('storagePermission', OLD.`id`, OLD.`obj`, NEW.`id`, NEW.`obj`);

CREATE TRIGGER `storagePermission_after_delete`
AFTER DELETE ON `storagePermission`
FOR EACH ROW
CALL LOG_DELETE('storagePermission', OLD.`id`);



CREATE TABLE `stock`
(
    `id` BINARY(16) NOT NULL,
    `productId` BINARY(16) NOT NULL,
    `storageId` BINARY(16) NOT NULL,
    `value` DECIMAL(20,5) NOT NULL,
    `obj` JSON AS (JSON_OBJECT(
        'id', BIN_TO_UUID(`id`),
        'productId', BIN_TO_UUID(`productId`),
        'storageId', BIN_TO_UUID(`storageId`),
        'value', `value`
    )) NOT NULL,
    CONSTRAINT `id` PRIMARY KEY (`id`),
    CONSTRAINT `[productId+storageId]` UNIQUE KEY (`productId`, `storageId`),
    CONSTRAINT `stock.productId`
        FOREIGN KEY (`productId`)
        REFERENCES `product` (`id`)
        ON DELETE RESTRICT
        ON UPDATE RESTRICT,
    INDEX `storageId` (`storageId`),
    CONSTRAINT `stock.storageId`
        FOREIGN KEY (`storageId`)
        REFERENCES `storage` (`id`)
        ON DELETE RESTRICT
        ON UPDATE RESTRICT
);

CREATE TRIGGER `stock_after_insert`
AFTER INSERT ON `stock`
FOR EACH ROW
CALL LOG_INSERT('stock', NEW.`id`, NEW.`obj`);

CREATE TRIGGER `stock_after_update`
AFTER UPDATE ON `stock`
FOR EACH ROW
CALL LOG_UPDATE('stock', OLD.`id`, OLD.`obj`, NEW.`id`, NEW.`obj`);

CREATE TRIGGER `stock_after_delete`
AFTER DELETE ON `stock`
FOR EACH ROW
CALL LOG_DELETE('stock', OLD.`id`);
