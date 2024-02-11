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
import { Card, Col, Form, Row, Table } from "react-bootstrap";
import { useAuth } from "./auth";
import { DialogButton, InlineSpinner } from "./common";
import { Database, ProductGroup } from "./db";
import { ObjectPermissionDialog } from "./dialog";
import { PermissionInput, ProductPropertyInput } from "./form";
import { EffectivProductGroup, useGroups } from "./groups";
import { useStrings } from "./strings";

const PermissionCount: React.FC<{ groupId: string }> = ({ groupId }) => {
  const count = useLiveQuery(
    async () =>
      await Database.instance.productPermission
        .where("groupId")
        .equals(groupId)
        .count(),
    [groupId]
  );

  return <>{count ?? <InlineSpinner />}</>;
};

const PermissionDialog: React.FC<{ group: ProductGroup | undefined }> = ({
  group,
}) => {
  const strings = useStrings();

  return (
    <ObjectPermissionDialog api="productPermission" object={group} size="xl">
      <Row>
        <Col>
          <Form.Group>
            <Form.Label>{strings.fieldSet.actions}</Form.Label>
            <Form.Check
              type="switch"
              checked={true}
              label={strings.label.listProductsPermission}
              disabled={true}
            />
            <PermissionInput
              name="add"
              label={strings.label.addProductsPermission}
            />
            <PermissionInput
              name="remove"
              label={strings.label.removeProductsPermission}
            />
          </Form.Group>
        </Col>
        <Col>
          <Form.Group>
            <Form.Label>{strings.fieldSet.general}</Form.Label>
            <ProductPropertyInput name="itemNumber" />
            <ProductPropertyInput name="barcode" />
            <ProductPropertyInput name="name" />
            <ProductPropertyInput name="description" />
          </Form.Group>
          <Form.Group>
            <Form.Label>{strings.fieldSet.price}</Form.Label>
            <ProductPropertyInput name="customPrice" />
            <ProductPropertyInput name="price" />
            <ProductPropertyInput name="priceIncludesVat" />
            <ProductPropertyInput name="vat" />
            <ProductPropertyInput name="stockUnit" />
          </Form.Group>
          <Form.Group>
            <Form.Label>{strings.fieldSet.status}</Form.Label>
            <ProductPropertyInput name="soldOut" />
            <ProductPropertyInput name="active" />
          </Form.Group>
        </Col>
        <Col>
          <Form.Group>
            <Form.Label>{strings.fieldSet.stock}</Form.Label>
            <ProductPropertyInput name="stockEnabled" />
            <ProductPropertyInput name="stockValue" />
            <ProductPropertyInput name="stockSafetyStock" />
            <ProductPropertyInput name="stockReorderLevel" />
          </Form.Group>
          <Form.Group>
            <Form.Label>{strings.fieldSet.pos}</Form.Label>
            <ProductPropertyInput name="alternativeNameInPos" />
            <ProductPropertyInput name="fav" />
            <ProductPropertyInput name="expressMode" />
            <ProductPropertyInput name="customQuantity" />
          </Form.Group>
          <Form.Group>
            <Form.Label>{strings.fieldSet.accounting}</Form.Label>
            <ProductPropertyInput name="alternativeNameOnReceipts" />
            <ProductPropertyInput name="accountingCode" />
            <ProductPropertyInput name="discountable" />
            <ProductPropertyInput name="productionCosts" />
          </Form.Group>
          <Form.Group>
            <Form.Label>{strings.fieldSet.advanced}</Form.Label>
            <ProductPropertyInput name="externalReference" />
            <ProductPropertyInput name="highlight" />
            <ProductPropertyInput name="sideDishOrder" />
            <ProductPropertyInput name="typeId" />
          </Form.Group>
        </Col>
      </Row>
    </ObjectPermissionDialog>
  );
};

const PermissionRow: React.FC<{
  group: EffectivProductGroup;
}> = ({ group }) => {
  const strings = useStrings();
  const { isAdmin } = useAuth();
  const className = group.active ? undefined : "text-muted";

  return (
    <tr>
      <td className={className}>
        {group.id === "*" ? strings.label.allProductGroups : group.fullName}
        <br />
        <span className="fw-lighter">
          {group.object !== undefined &&
            group.object.typeId !== null &&
            strings.label.type(group.object.typeId)}
        </span>
      </td>
      <td className={className}>
        {strings.label.booleanState(group.hasPermission)}
      </td>
      <td className={className}>
        {strings.label.booleanState(group.addProduct)}
      </td>
      <td className={className}>
        {strings.label.booleanState(group.removeProduct)}
      </td>
      <td className={className}>{group.editProductProperties.size}</td>
      {isAdmin && (
        <>
          <td className={className}>
            <PermissionCount groupId={group.id} />
          </td>
          <td>
            <DialogButton
              variant="primary"
              open={<PermissionDialog group={group.object} />}
            >
              {strings.button.modify}
            </DialogButton>
          </td>
        </>
      )}
    </tr>
  );
};

export const Permissions: React.FC = () => {
  const strings = useStrings();
  const { isAdmin } = useAuth();
  const allGroups = useGroups();
  const groups = useMemo(() => {
    const result = [...allGroups.values()].filter(
      (group) => isAdmin || (group.active && group.hasPermission)
    );
    return Object.freeze(result);
  }, [isAdmin, allGroups]);

  return (
    <Card>
      <Card.Header>{strings.title.permissions}</Card.Header>
      <Card.Body>
        <Table bordered hover responsive>
          <thead>
            <tr>
              <th>{strings.column.productGroup}</th>
              <th>{strings.column.listProducts}</th>
              <th>{strings.column.addProducts}</th>
              <th>{strings.column.removeProducts}</th>
              <th>{strings.column.properties}</th>
              {isAdmin && (
                <>
                  <th>{strings.column.permissionCount}</th>
                  <th>{strings.column.manage}</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <PermissionRow key={group.id} group={group} />
            ))}
          </tbody>
        </Table>
      </Card.Body>
    </Card>
  );
};
