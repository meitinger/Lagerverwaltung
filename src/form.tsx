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

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { Button, Form, InputGroup } from "react-bootstrap";
import { Product, Storage } from "./db";
import {
  FieldNotInFormDataError,
  InvalidTypeError,
  MissingContextError,
} from "./errors";
import { Globals } from "./globals";
import { useGroups } from "./groups";
import { useStrings } from "./strings";

type Field = keyof Product | keyof Storage;

export type FormData = Readonly<{
  [name: string]: string | number | boolean | null;
}>;

export const FormDataContext = createContext<
  [FormData, React.Dispatch<React.SetStateAction<FormData>>]
>([
  {},
  () => {
    throw new MissingContextError("FormData");
  },
]);

export const FormPermissionContext = createContext<(name: string) => boolean>(
  () => true
);

export const useFormData = <S extends string | number | boolean>(
  name: string,
  defaultValue: S
): [S, React.Dispatch<React.SetStateAction<S | null>>] => {
  const [data, setData] = useContext(FormDataContext);
  const value = useMemo(() => {
    if (!(name in data)) {
      throw new FieldNotInFormDataError(name);
    }
    const val = data[name];
    if (val === null) {
      return defaultValue;
    }
    if (typeof val !== typeof defaultValue) {
      throw new InvalidTypeError(
        name,
        val,
        typeof defaultValue as "string" | "number" | "boolean"
      );
    }
    return val as S;
  }, [data, name, defaultValue]);
  const setValue = useCallback(
    (setter: React.SetStateAction<S | null>): void =>
      setData((currentData) =>
        Object.freeze(
          typeof setter === "function"
            ? { ...currentData, [name]: setter(currentData[name] as S | null) }
            : { ...currentData, [name]: setter }
        )
      ),
    [setData, name]
  );
  return [value, setValue];
};

export const useFormPermission = (name: string): boolean => {
  const hasPermission = useContext(FormPermissionContext);
  const value = useMemo(() => hasPermission(name), [hasPermission, name]);
  return value;
};

export const CheckboxInput: React.FC<{
  name: Field;
  required?: boolean;
}> = ({ name, required }) => {
  const strings = useStrings();
  const [value, setValue] = useFormData<boolean>(name, false);
  const hasPermission = useFormPermission(name);
  const change = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void =>
      setValue(event.currentTarget.checked),
    [setValue]
  );

  return (
    <Form.Group className="mb-3">
      <Form.Label>{strings.field[name]}</Form.Label>
      <Form.Check
        type="checkbox"
        required={required}
        disabled={!hasPermission}
        checked={value}
        onChange={change}
      />
    </Form.Group>
  );
};

export const BarcodeInput: React.FC<{
  maxLength?: number;
}> = ({ maxLength }) => {
  const strings = useStrings();
  const [value, setValue] = useFormData<string>("barcode", "");
  const [required] = useState(value !== "");
  const hasPermission = useFormPermission("barcode");
  const generate = useCallback(() => {
    const number =
      "02" +
      Math.round(Math.random() * 9999999999)
        .toFixed(0)
        .padStart(10, "0");
    let checksum = 0;
    for (let i = 0; i < 12; i++) {
      checksum += (number.charCodeAt(i) - 48) * (i % 2 === 0 ? 1 : 3);
    }
    checksum %= 10;
    setValue(number + (checksum === 0 ? 0 : 10 - checksum).toFixed(0));
  }, [setValue]);
  const change = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      const value = event.currentTarget.value;
      // the field is required, since product_barcode cannot be unset via API
      setValue(value.length === 0 ? null : value);
    },
    [setValue]
  );

  return (
    <Form.Group className="mb-3">
      <Form.Label>{strings.field.barcode}</Form.Label>
      <InputGroup>
        <Form.Control
          type="text"
          required={required}
          disabled={!hasPermission}
          maxLength={maxLength}
          value={value}
          onChange={change}
        />
        <Button
          variant="outline-secondary"
          disabled={!hasPermission}
          onClick={generate}
        >
          {strings.button.generateBarcode}
        </Button>
      </InputGroup>
    </Form.Group>
  );
};

export const NumberInput: React.FC<{
  name: Field;
  required?: boolean;
}> = ({ name, required }) => {
  const strings = useStrings();
  const [value, setValue] = useFormData<number>(name, Number.NaN);
  const hasPermission = useFormPermission(name);
  const change = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      const value = parseFloat(event.currentTarget.value);
      setValue(Number.isNaN(value) ? null : value);
    },
    [setValue]
  );

  return (
    <Form.Group className="mb-3">
      <Form.Label>{strings.field[name]}</Form.Label>
      <Form.Control
        type="number"
        required={required}
        disabled={!hasPermission}
        value={Number.isNaN(value) ? "" : value}
        min={Globals.minNumber}
        max={Globals.maxNumber}
        step={Globals.stepNumber}
        onChange={change}
      />
    </Form.Group>
  );
};

export const PermissionInput: React.FC<{
  name: string;
  label?: string;
  required?: boolean;
}> = ({ name, label, required }) => {
  const [value, setValue] = useFormData<boolean>(name, false);
  const hasPermission = useFormPermission(name);
  const change = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void =>
      setValue(event.currentTarget.checked),
    [setValue]
  );

  return (
    <Form.Check
      type="switch"
      label={label}
      required={required}
      disabled={!hasPermission}
      checked={value}
      onChange={change}
    />
  );
};

export const ProductGroupInput: React.FC<{
  setGroupId: (groupId: string) => void;
}> = ({ setGroupId }) => {
  const strings = useStrings();
  const allGroups = useGroups();
  const [id] = useFormData<string>("id", "*");
  const [value, setValue] = useFormData<string>("groupId", "*");
  const hasPermission = id === "*" || allGroups.get(value)?.removeProduct;
  const groups = useMemo(
    () =>
      Object.freeze(
        [...allGroups.values()].filter(
          (group) => group.hasPermission || group.id === value
        )
      ),
    [allGroups, value]
  );
  const change = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>): void => {
      // the empty group is mapped to the empty option to trigger required
      const value =
        event.currentTarget.value === "" ? "*" : event.currentTarget.value;
      setValue(value);
      setGroupId(value);
    },
    [setValue, setGroupId]
  );

  return (
    <Form.Group className="mb-3">
      <Form.Label>{strings.field.groupId}</Form.Label>
      <Form.Select
        required={true}
        disabled={!hasPermission}
        value={value === "*" ? "" : value}
        onChange={change}
      >
        {groups.map((group) => (
          <option
            key={group.id}
            value={group.id === "*" ? "" : group.id}
            disabled={!group.active || !group.addProduct}
          >
            {group.id === "*" ? strings.emptyOption.groupId : group.fullName}
          </option>
        ))}
      </Form.Select>
    </Form.Group>
  );
};

export const ProductPropertyInput: React.FC<{
  name: keyof Product;
}> = ({ name }) => {
  const strings = useStrings();
  const key = name === "typeId" ? "type" : name;
  const [values, setValues] = useFormData<string>("properties", "");
  const hasPermission = useFormPermission("properties");
  const value = useMemo(() => values.split(",").includes(key), [values, key]);
  const change = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void =>
      setValues((currentValues) => {
        const values = (currentValues ?? "")
          .split(",")
          .filter((v) => v.length > 0);
        return (
          event.currentTarget.checked
            ? values.concat(key)
            : values.filter((v) => v !== key)
        ).join(",");
      }),
    [setValues, key]
  );

  return (
    <Form.Check
      type="switch"
      label={strings.field[name]}
      disabled={!hasPermission}
      checked={value}
      onChange={change}
    />
  );
};

export const ProductStockUnitInput: React.FC = () => {
  const strings = useStrings();
  const [value, setValue] = useFormData<string>("stockUnit", "");
  const [required] = useState(value !== "");
  const hasPermission = useFormPermission("stockUnit");
  const change = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>): void =>
      // the empty option is disabled, since product_stock_unit cannot be unset via API
      setValue(
        event.currentTarget.value.length > 0 ? event.currentTarget.value : null
      ),
    [setValue]
  );

  return (
    <Form.Group className="mb-3">
      <Form.Label>{strings.field.stockUnit}</Form.Label>
      <Form.Select disabled={!hasPermission} value={value} onChange={change}>
        <option value="" disabled={required}>
          {strings.emptyOption.stockUnit}
        </option>
        {Object.entries(strings.unit).map(([id, { label }]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </Form.Select>
    </Form.Group>
  );
};

export const ProductTypeInput: React.FC<{
  types: Readonly<{ [id: number]: string }>;
}> = ({ types }) => {
  const strings = useStrings();
  const [, setFormData] = useContext(FormDataContext);
  const [initialValue] = useFormData<number>("typeId", 0);
  const [value, setValue] = useState(initialValue);
  const hasPermission = useFormPermission("type");
  const change = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>): void => {
      const id = parseInt(event.currentTarget.value);
      // empty type string clears typeId
      const code = id === 0 || !(id in types) ? "" : types[id];
      setValue(id);
      setFormData((data) => Object.freeze({ ...data, type: code }));
    },
    [types, setValue, setFormData]
  );

  return (
    <Form.Group className="mb-3">
      <Form.Label>{strings.field.typeId}</Form.Label>
      <Form.Select disabled={!hasPermission} value={value} onChange={change}>
        <option value="0">{strings.emptyOption.typeId}</option>
        {Object.entries(strings.productType).map(([id, label]) => (
          <option key={id} value={id} disabled={!(id in types)}>
            {label}
          </option>
        ))}
      </Form.Select>
    </Form.Group>
  );
};

export const TextInput: React.FC<{
  name: Field;
  required?: boolean;
  maxLength?: number;
}> = ({ name, required, maxLength }) => {
  const strings = useStrings();
  const [value, setValue] = useFormData<string>(name, "");
  const hasPermission = useFormPermission(name);
  const change = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      const value = event.currentTarget.value;
      setValue(value.length === 0 ? null : value);
    },
    [setValue]
  );

  return (
    <Form.Group className="mb-3">
      <Form.Label>{strings.field[name]}</Form.Label>
      <Form.Control
        type="text"
        required={required}
        disabled={!hasPermission}
        maxLength={maxLength}
        value={value}
        onChange={change}
      />
    </Form.Group>
  );
};
