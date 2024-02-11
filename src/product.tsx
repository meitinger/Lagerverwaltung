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
import React, { useCallback, useMemo, useState } from "react";
import { ButtonGroup, Card, Col, Row, Table } from "react-bootstrap";
import { Barcode, DialogButton, SpinnerRow } from "./common";
import { Database, Product, Storage } from "./db";
import { Dialog, ObjectDeleteDialog, ObjectDialog } from "./dialog";
import {
  BarcodeInput,
  CheckboxInput,
  FormPermissionContext,
  NumberInput,
  ProductGroupInput,
  ProductStockUnitInput,
  ProductTypeInput,
  TextInput,
} from "./form";
import { Globals } from "./globals";
import { useGroups } from "./groups";
import { StockInput } from "./stock";
import { StorageList } from "./storage";
import { useStrings } from "./strings";

const types = Object.freeze({
  1: "food",
  2: "drink",
  7: "standard",
  8: "discount",
  19: "deposit-sale",
  20: "deposit-return",
});

const ProductDialog: React.FC<{
  method: "PUT" | "POST";
  template: Product;
}> = ({ method, template }) => {
  const strings = useStrings();
  const groups = useGroups();
  const [groupId, setGroupId] = useState(template.groupId);
  const hasPermission = useCallback(
    (property: string): boolean =>
      !!groups.get(groupId)?.editProductProperties.has(property),
    [groups, groupId]
  );

  return (
    <ObjectDialog template={template} api="product" method={method} size="lg">
      <FormPermissionContext.Provider value={hasPermission}>
        <Row>
          <Col>
            <h3>{strings.fieldSet.general}</h3>
            <ProductGroupInput setGroupId={setGroupId} />
            <TextInput name="itemNumber" maxLength={100} />
            <BarcodeInput maxLength={255} />
            <TextInput name="name" maxLength={255} required />
            <TextInput name="description" />
            <h3>{strings.fieldSet.price}</h3>
            <CheckboxInput name="customPrice" />
            <NumberInput name="price" required />
            <CheckboxInput name="priceIncludesVat" />
            <NumberInput name="vat" required />
            <ProductStockUnitInput />
            <h3>{strings.fieldSet.status}</h3>
            <CheckboxInput name="soldOut" />
            <CheckboxInput name="active" />
          </Col>
          <Col>
            <h3>{strings.fieldSet.stock}</h3>
            <CheckboxInput name="stockEnabled" />
            <NumberInput name="stockValue" required />
            <NumberInput name="stockSafetyStock" />
            <NumberInput name="stockReorderLevel" />
            <h3>{strings.fieldSet.pos}</h3>
            <TextInput name="alternativeNameInPos" maxLength={100} />
            <CheckboxInput name="fav" />
            <CheckboxInput name="expressMode" />
            <CheckboxInput name="customQuantity" />
            <h3>{strings.fieldSet.accounting}</h3>
            <TextInput name="alternativeNameOnReceipts" maxLength={255} />
            <TextInput name="accountingCode" maxLength={50} />
            <CheckboxInput name="discountable" />
            <NumberInput name="productionCosts" />
            <h3>{strings.fieldSet.advanced}</h3>
            <TextInput name="externalReference" maxLength={50} />
            <CheckboxInput name="highlight" />
            <CheckboxInput name="sideDishOrder" />
            <ProductTypeInput types={types} />
          </Col>
        </Row>
      </FormPermissionContext.Provider>
    </ObjectDialog>
  );
};

export const ProductList: React.FC<{
  ids?: readonly string[];
  storage?: Storage;
  readOnly?: boolean;
}> = ({ ids, storage, readOnly }) => {
  const strings = useStrings();
  const allProducts = useLiveQuery(async () => {
    const products =
      ids === undefined
        ? await Database.instance.product.toArray()
        : await Database.instance.product.where("id").anyOf(ids).toArray();
    products.sort((a, b) =>
      strings.collator.compare(a.itemNumber ?? a.name, b.itemNumber ?? b.name)
    );
    return Object.freeze(products);
  }, [ids, strings]);
  const groups = useGroups();
  const products = useMemo(
    () =>
      allProducts === undefined
        ? undefined
        : Object.freeze(
            allProducts.filter((product) => {
              const group = groups.get(product.groupId);
              return (
                group !== undefined &&
                group.active &&
                group.hasPermission &&
                (product.active || group.editProductProperties.has("active"))
              );
            })
          ),
    [allProducts, groups]
  );

  return (
    <Table bordered hover responsive>
      <thead>
        <tr>
          <th>{strings.column.barcode}</th>
          <th>{strings.column.product}</th>
          <th>{strings.column.productGroup}</th>
          <th>{strings.column.price}</th>
          <th>
            {storage === undefined
              ? strings.column.storeStock
              : strings.column.stock}
          </th>
          {storage === undefined && <th>{strings.column.manage}</th>}
        </tr>
      </thead>
      <tbody>
        {products === undefined ? (
          <SpinnerRow colSpan={6 + (storage === undefined ? 1 : 0)} />
        ) : (
          products.map((product) => (
            <ProductRow
              key={product.id}
              product={product}
              storage={storage}
              readOnly={readOnly}
            />
          ))
        )}
      </tbody>
    </Table>
  );
};

const ProductRow: React.FC<{
  readOnly?: boolean;
  product: Product;
  storage?: Storage;
}> = ({ readOnly, product, storage }) => {
  const strings = useStrings();
  const groups = useGroups();
  const className = product.active ? undefined : "text-muted";

  return (
    <tr>
      <td className={className}>
        {product.barcode !== null && (
          <Barcode
            name={product.itemNumber ?? product.name}
            ean={product.barcode}
          >
            <span className="fst-italic">{product.barcode}</span>
          </Barcode>
        )}
      </td>
      <td className={className}>
        <span className="fw-bolder">{product.itemNumber}</span>
        {product.externalReference !== null && (
          <>
            <br />
            <span className="fw-lighter">{product.externalReference}</span>
          </>
        )}
        <br />
        {product.name}
        {product.description !== null && (
          <>
            <br />
            <span className="fw-lighter">{product.description}</span>
          </>
        )}
      </td>
      <td className={className}>
        {groups.get(product.groupId)?.fullName}
        {product.typeId !== null && (
          <>
            <br />
            <span className="fw-lighter">
              {strings.label.type(product.typeId)}
            </span>
          </>
        )}
      </td>
      <td className={className}>
        {product.customPrice ? (
          <span className="fst-italic">{strings.label.customPrice}</span>
        ) : product.priceIncludesVat ? (
          strings.label.price(product.price, product.vat / 100)
        ) : (
          strings.label.price(
            product.price / (1 + product.vat / 100),
            undefined
          )
        )}
        {product.productionCosts !== null && (
          <>
            <br />
            <span className="fw-lighter">
              {strings.label.productionCosts(product.productionCosts)}
            </span>
          </>
        )}
      </td>
      <td className={className}>
        {storage === undefined && (
          <>
            {product.stockEnabled ? (
              strings.label.quantity(
                product.stockValue,
                product.stockUnit,
                "long"
              )
            ) : (
              <span className="fst-italic">
                {strings.label.stockDeactivated}
              </span>
            )}
            {product.soldOut && (
              <>
                <br />
                <span className="fw-lighter fst-italic">
                  {strings.label.productSoldOut}
                </span>
              </>
            )}
          </>
        )}
        {storage !== undefined && (
          <StockInput readOnly={readOnly} product={product} storage={storage} />
        )}
      </td>
      {storage === undefined && (
        <td>
          <ButtonGroup>
            <DialogButton
              variant="primary"
              open={<StockDialog product={product} />}
            >
              {strings.button.stock}
            </DialogButton>
            <DialogButton
              variant="secondary"
              open={<ProductDialog method="POST" template={product} />}
            >
              {strings.button.modify}
            </DialogButton>
            {groups.get(product.groupId)?.removeProduct && (
              <DialogButton
                variant="danger"
                open={<ObjectDeleteDialog api="product" object={product} />}
              >
                {strings.button.delete}
              </DialogButton>
            )}
          </ButtonGroup>
        </td>
      )}
    </tr>
  );
};

export const Products: React.FC = () => {
  const strings = useStrings();
  const groups = useGroups();
  const canAdd = useMemo(() => {
    for (const group of groups.values()) {
      if (group.addProduct) {
        return true;
      }
    }
    return false;
  }, [groups]);

  return (
    <Card>
      <Card.Header>{strings.title.products}</Card.Header>
      <Card.Body>
        <ProductList />
      </Card.Body>
      {canAdd && (
        <Card.Footer className="text-end">
          <ButtonGroup>
            <DialogButton
              variant="primary"
              open={
                <ProductDialog method="PUT" template={Globals.defaultProduct} />
              }
            >
              {strings.button.newProduct}
            </DialogButton>
          </ButtonGroup>
        </Card.Footer>
      )}
    </Card>
  );
};

const StockDialog: React.FC<{ product: Product }> = ({ product }) => {
  const strings = useStrings();

  return (
    <Dialog title={strings.title.productStockDialog(product)} size="lg">
      <StorageList product={product} />
    </Dialog>
  );
};
