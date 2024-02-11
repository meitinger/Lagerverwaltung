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

import {
  IDynamicPerson,
  PeoplePicker,
  Person,
  PersonType,
  PersonViewType,
  UserType,
} from "@microsoft/mgt-react";
import { useLiveQuery } from "dexie-react-hooks";
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button, Form, InputGroup, Modal, Table } from "react-bootstrap";
import { PermissionApi, invokeWithSync } from "./api";
import { ProgressSpan, SpinnerRow, useProgress } from "./common";
import { Database, Permissions, Product, ProductGroup, Storage } from "./db";
import { MissingContextError, OperationInProgressError } from "./errors";
import { FormData, FormDataContext } from "./form";
import { useStrings } from "./strings";

export const DialogContext = createContext<
  React.Dispatch<React.SetStateAction<React.ReactNode | undefined>>
>(() => {
  throw new MissingContextError("Dialog");
});

type DialogSize = "sm" | "lg" | "xl";

const alwaysTrue = () => true;

export const Dialog: React.FC<
  React.PropsWithChildren<{
    title: string;
    size?: DialogSize;
    action?: () => Promise<void>;
    canCancel?: () => boolean;
  }>
> = ({ title, size, action, canCancel, children }) => {
  const strings = useStrings();
  const formRef = useRef<HTMLFormElement>(null);
  const [close, setClose] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [subDialog, setSubDialog] = useState<React.ReactNode | undefined>();
  const setDialog = useContext(DialogContext);
  const hide = useCallback(() => {
    if (canCancel === undefined || canCancel()) {
      setClose(true);
    }
  }, [canCancel]);
  const entering = useCallback(() => setHidden(false), []);
  const exited = useCallback(() => {
    setHidden(true);
    if (subDialog === undefined) {
      setDialog(undefined);
    }
  }, [subDialog, setDialog]);
  const invoke = useCallback(async () => {
    const form = formRef.current;
    if (form === null || !form.reportValidity()) {
      return;
    }
    if (action !== undefined) {
      await action();
    }
    setClose(true);
  }, [action]);
  const [active, confirm] = useProgress(invoke);

  return (
    <DialogContext.Provider value={setSubDialog}>
      {hidden && subDialog}
      <Modal
        show={!close && subDialog === undefined}
        size={size}
        onHide={hide}
        onEntering={entering}
        onExited={exited}
      >
        <Modal.Header closeButton>
          <Modal.Title>{title}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form ref={formRef}>
            <fieldset disabled={active}>{children} </fieldset>
          </Form>
        </Modal.Body>
        {(action !== undefined || canCancel !== undefined) && (
          <Modal.Footer>
            {action !== undefined && (
              <Button variant="primary" disabled={active} onClick={confirm}>
                <ProgressSpan active={active}>{strings.button.ok}</ProgressSpan>
              </Button>
            )}
            {canCancel !== undefined && (
              <Button variant="secondary" disabled={active} onClick={hide}>
                {strings.button.cancel}
              </Button>
            )}
          </Modal.Footer>
        )}
      </Modal>
    </DialogContext.Provider>
  );
};

export const ObjectDialog: React.FC<
  React.PropsWithChildren<
    (
      | {
          api: "product";
          template: Product;
        }
      | {
          api: "storage";
          template: Storage;
        }
    ) & {
      method: "PUT" | "POST";
      size?: DialogSize;
    }
  >
> = ({ api, template, method, size, children }) => {
  const strings = useStrings();
  const [formData, setFormData] = useState(template as FormData);
  const modified = useMemo(
    () =>
      Object.freeze(
        Object.fromEntries(
          Object.keys(formData)
            .filter((prop) => (template as FormData)[prop] !== formData[prop])
            .map((prop) => [prop, formData[prop]])
        )
      ),
    [template, formData]
  );
  const invoke = useCallback(
    () =>
      invokeWithSync(api, method, {
        id: template.id,
        ...(api === "product" ? { groupId: template.groupId } : undefined),
        ...modified,
      }),
    [api, method, template, modified]
  );
  const canCancel = useCallback(
    () =>
      Object.keys(modified).length === 0 ||
      window.confirm(strings.message.discardChanges),

    [modified, strings]
  );

  return (
    <Dialog
      size={size}
      title={strings.title.objectDialog(api, method, template)}
      action={invoke}
      canCancel={canCancel}
    >
      <FormDataContext.Provider value={[formData, setFormData]}>
        {children}
      </FormDataContext.Provider>
    </Dialog>
  );
};

export const ObjectDeleteDialog: React.FC<
  | {
      api: "product";
      object: Product;
    }
  | {
      api: "storage";
      object: Storage;
    }
> = ({ api, object }) => {
  const strings = useStrings();
  const invokeDelete = useCallback(
    () =>
      invokeWithSync(api, "DELETE", {
        id: object.id,
      }),
    [api, object.id]
  );

  return (
    <Dialog
      title={strings.title.objectDialog(api, "DELETE", object)}
      action={invokeDelete}
      canCancel={alwaysTrue}
    >
      {strings.message.confirmDeletion(api, object)}
    </Dialog>
  );
};

export const ObjectPermissionDialog: React.FC<
  React.PropsWithChildren<
    (
      | {
          api: "productPermission";
          object: ProductGroup | undefined;
        }
      | {
          api: "storagePermission";
          object: Storage | undefined;
        }
    ) & {
      size?: DialogSize;
    }
  >
> = ({ api, object, size, children }) => {
  const strings = useStrings();
  const id = object === undefined ? "*" : object.id;
  const key = (() => {
    switch (api) {
      case "productPermission":
        return "groupId";
      case "storagePermission":
        return "storageId";
    }
  })();
  const permissions = useLiveQuery(async () => {
    const getTable = () => {
      switch (api) {
        case "productPermission":
          return Database.instance.productPermission;
        case "storagePermission":
          return Database.instance.storagePermission;
      }
    };
    return Object.freeze(await getTable().where(key).equals(id).toArray());
  }, [api, key, id]);
  const [selectedPeople, setSelectedPeople] = useState<IDynamicPerson[]>([]);
  const changeSelection = useCallback(
    async (e: CustomEvent<IDynamicPerson[]>) => {
      if (selectedPeople.length > 0) {
        throw new OperationInProgressError();
      }
      setSelectedPeople(e.detail);
      try {
        for (const person of e.detail) {
          await invokeWithSync(api, "PUT", {
            [key]: id,
            userId: person.id,
          });
        }
      } finally {
        setSelectedPeople([]);
      }
    },
    [selectedPeople, api, key, id]
  );
  const active = selectedPeople.length > 0;

  return (
    <Dialog title={strings.title.permissionDialog(api, object)} size={size}>
      <Table bordered hover responsive>
        <thead>
          <tr>
            <th>{strings.column.user}</th>
            <th>{strings.column.permissions}</th>
            <th>{strings.column.manage}</th>
          </tr>
        </thead>
        <tbody>
          {permissions === undefined ? (
            <SpinnerRow colSpan={3} />
          ) : (
            permissions.map((permission) => (
              <PermissionRow
                key={permission.id}
                api={api}
                permission={permission}
              >
                {children}
              </PermissionRow>
            ))
          )}
        </tbody>
      </Table>
      <InputGroup>
        <InputGroup.Text>
          <ProgressSpan active={active}>
            {strings.button.newPermission}
          </ProgressSpan>
        </InputGroup.Text>
        <PeoplePicker
          className="form-control"
          selectionMode="single"
          disabled={active}
          type={PersonType.person}
          userType={UserType.user}
          selectedPeople={selectedPeople}
          selectionChanged={changeSelection}
        />
      </InputGroup>
    </Dialog>
  );
};

const PermissionRow: React.FC<
  React.PropsWithChildren<{
    api: PermissionApi;
    permission: Permissions;
  }>
> = ({ api, permission, children }) => {
  const strings = useStrings();
  const [tempPermission, setTempPermission] = useState<FormData | undefined>();
  const setFromData = useCallback(
    async (value: React.SetStateAction<FormData>): Promise<void> => {
      if (tempPermission !== undefined) {
        throw new OperationInProgressError();
      }
      const newPermission =
        typeof value === "function" ? value(permission) : value;
      setTempPermission(newPermission);
      try {
        await invokeWithSync(api, "PUT", newPermission);
      } finally {
        setTempPermission(undefined);
      }
    },
    [tempPermission, api, permission]
  );
  const invokeDelete = useCallback(
    () => invokeWithSync(api, "DELETE", permission),
    [api, permission]
  );
  const [deleting, deleteClick] = useProgress(invokeDelete);
  const formData = tempPermission ?? (permission as FormData);
  const isBusy = deleting || tempPermission !== undefined;

  return (
    <tr>
      <td>
        <Person
          showPresence={false}
          userId={permission.userId}
          view={PersonViewType.oneline}
        />
      </td>
      <td>
        <fieldset disabled={isBusy}>
          <FormDataContext.Provider value={[formData, setFromData]}>
            {children}
          </FormDataContext.Provider>
        </fieldset>
      </td>
      <td>
        <Button variant="danger" disabled={isBusy} onClick={deleteClick}>
          <ProgressSpan active={deleting}>{strings.button.delete}</ProgressSpan>
        </Button>
      </td>
    </tr>
  );
};
