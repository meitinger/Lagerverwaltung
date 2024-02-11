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

import { useLiveQuery } from "dexie-react-hooks";
import React, { useMemo } from "react";
import { ButtonGroup, Card, Col, Form, Row, Table } from "react-bootstrap";
import { useAuth } from "./auth";
import {
  CenteredSpinner,
  DialogButton,
  InlineSpinner,
  SpinnerRow,
} from "./common";
import { Database, Product, Storage } from "./db";
import {
  Dialog,
  ObjectDeleteDialog,
  ObjectDialog,
  ObjectPermissionDialog,
} from "./dialog";
import { CheckboxInput, PermissionInput, TextInput } from "./form";
import { Globals } from "./globals";
import { ProductList } from "./product";
import { StockInput } from "./stock";
import { useStrings } from "./strings";

const PermissionDialog: React.FC<{ storage?: Storage }> = ({ storage }) => {
  const strings = useStrings();

  return (
    <ObjectPermissionDialog api="storagePermission" object={storage} size="lg">
      <Row>
        <Col>
          <Form.Check
            type="switch"
            checked={true}
            label={strings.label.listStoragePermission}
            disabled={true}
          />
        </Col>
        <Col>
          <PermissionInput
            name="stock"
            label={strings.label.stockStoragePermission}
          />
        </Col>
      </Row>
    </ObjectPermissionDialog>
  );
};

const PermissionDialogButton: React.FC<{ storage?: Storage }> = ({
  storage,
}) => {
  const strings = useStrings();
  const count = useLiveQuery(
    async () =>
      await Database.instance.storagePermission
        .where("storageId")
        .equals(storage === undefined ? "*" : storage.id)
        .count(),
    [storage]
  );

  return (
    <DialogButton
      variant="secondary"
      open={<PermissionDialog storage={storage} />}
    >
      {storage === undefined
        ? strings.button.globalPermissions
        : strings.button.permissions}
      <> ({count ?? <InlineSpinner />})</>
    </DialogButton>
  );
};

const ProductCount: React.FC<{ storageId: string }> = ({ storageId }) => {
  const count = useLiveQuery(
    async () =>
      await Database.instance.stock
        .where("storageId")
        .equals(storageId)
        .count(),
    [storageId]
  );

  return <>{count ?? <InlineSpinner />}</>;
};

const StockDialog: React.FC<{
  storage: Storage;
  readOnly?: boolean;
}> = ({ storage, readOnly }) => {
  const strings = useStrings();
  const productIds = useLiveQuery(
    async () =>
      Object.freeze(
        await Database.instance.stock
          .where("storageId")
          .equals(storage.id)
          .toArray((stock) => stock.map((e) => e.productId))
      ),
    [storage.id]
  );

  return (
    <Dialog title={strings.title.storageStockDialog(storage)} size="xl">
      {productIds === undefined ? (
        <CenteredSpinner />
      ) : (
        <ProductList ids={productIds} storage={storage} readOnly={readOnly} />
      )}
    </Dialog>
  );
};

const StorageDialog: React.FC<{
  method: "PUT" | "POST";
  template: Storage;
}> = ({ method, template }) => (
  <ObjectDialog template={template} api="storage" method={method}>
    <TextInput name="name" maxLength={255} required />
    <CheckboxInput name="active" />
  </ObjectDialog>
);

export const StorageList: React.FC<{ product?: Product }> = ({ product }) => {
  const strings = useStrings();
  const { userId, isAdmin } = useAuth();
  const allStorages = useLiveQuery(
    async () =>
      Object.freeze(
        (await Database.instance.storage.toArray()).sort((a, b) =>
          strings.collator.compare(a.name, b.name)
        )
      ),
    [strings]
  );
  const permittedIds = useLiveQuery(async () => {
    const result = new Map<string, boolean>();
    await Database.instance.storagePermission
      .where("userId")
      .equals(userId)
      .each((perm) => result.set(perm.storageId, perm.stock));
    return Object.freeze(result);
  }, [userId]);
  const storages = useMemo(
    () =>
      product === undefined && isAdmin
        ? allStorages
        : permittedIds === undefined || allStorages === undefined
        ? undefined
        : Object.freeze(
            allStorages.filter(
              (storage) =>
                (storage.active || isAdmin) &&
                (permittedIds.has("*") || permittedIds.has(storage.id))
            )
          ),
    [product, isAdmin, allStorages, permittedIds]
  );

  return (
    <Table bordered hover responsive>
      <thead>
        <tr>
          <th>{strings.column.name}</th>
          <th>
            {product === undefined
              ? strings.column.productCount
              : strings.column.stock}
          </th>
          {product === undefined && <th>{strings.column.manage}</th>}
        </tr>
      </thead>
      <tbody>
        {storages === undefined || permittedIds === undefined ? (
          <SpinnerRow colSpan={2 + (product === undefined ? 1 : 0)} />
        ) : (
          storages.map((storage) => (
            <StorageRow
              key={storage.id}
              readOnly={
                !(permittedIds?.get("*") || permittedIds?.get(storage.id))
              }
              storage={storage}
              product={product}
            />
          ))
        )}
      </tbody>
    </Table>
  );
};

const StorageRow: React.FC<{
  readOnly?: boolean;
  storage: Storage;
  product?: Product;
}> = ({ readOnly, storage, product }) => {
  const strings = useStrings();
  const { isAdmin } = useAuth();
  const className = storage.active ? undefined : "text-muted";

  return (
    <tr>
      <td className={className}>{storage.name}</td>
      <td className={className}>
        {product === undefined && <ProductCount storageId={storage.id} />}
        {product !== undefined && (
          <StockInput readOnly={readOnly} storage={storage} product={product} />
        )}
      </td>
      {product === undefined && (
        <td>
          <ButtonGroup>
            <DialogButton
              variant="primary"
              open={<StockDialog storage={storage} readOnly={readOnly} />}
            >
              {strings.button.stock}
            </DialogButton>
            {isAdmin && (
              <>
                <DialogButton
                  variant="secondary"
                  open={<StorageDialog method="POST" template={storage} />}
                >
                  {strings.button.modify}
                </DialogButton>
                <PermissionDialogButton storage={storage} />
                <DialogButton
                  variant="danger"
                  open={<ObjectDeleteDialog api="storage" object={storage} />}
                >
                  {strings.button.delete}
                </DialogButton>
              </>
            )}
          </ButtonGroup>
        </td>
      )}
    </tr>
  );
};

export const Storages: React.FC = () => {
  const strings = useStrings();
  const { isAdmin } = useAuth();

  return (
    <Card>
      <Card.Header>{strings.title.storages}</Card.Header>
      <Card.Body>
        <StorageList />
      </Card.Body>
      {isAdmin && (
        <Card.Footer className="text-end">
          <ButtonGroup>
            <DialogButton
              variant="primary"
              open={
                <StorageDialog method="PUT" template={Globals.defaultStorage} />
              }
            >
              {strings.button.newStorage}
            </DialogButton>
            <PermissionDialogButton />
          </ButtonGroup>
        </Card.Footer>
      )}
    </Card>
  );
};
