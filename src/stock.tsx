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
import React, { useCallback, useRef, useState } from "react";
import { Button, Form, InputGroup } from "react-bootstrap";
import { invokeWithSync } from "./api";
import { InlineSpinner, ProgressSpan, useProgress } from "./common";
import { Database, Product, Storage } from "./db";
import { Globals } from "./globals";
import { useStrings } from "./strings";

const calcVariant = (delta: number, focused: boolean) =>
  Number.isNaN(delta)
    ? "outline-danger"
    : focused
    ? "primary"
    : "outline-secondary";

const StockControl: React.FC<{
  disabled?: boolean;
  label: string;
  value: number | undefined;
  setValue: React.Dispatch<React.SetStateAction<number | undefined>>;
  setFocused: React.Dispatch<React.SetStateAction<boolean>>;
  buttonRef: React.RefObject<HTMLButtonElement>;
}> = ({ disabled, label, value, setValue, setFocused, buttonRef }) => {
  const change = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void =>
      setValue(
        event.currentTarget.value.length === 0
          ? undefined
          : Number.parseFloat(event.currentTarget.value)
      ),
    [setValue]
  );
  const keyUp = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === "Enter") {
        buttonRef.current?.click();
      }
    },
    [buttonRef]
  );
  const focus = useCallback(() => setFocused(true), [setFocused]);
  const blur = useCallback(() => setFocused(false), [setFocused]);

  return (
    <Form.Control
      type="number"
      min={0}
      max={Globals.maxNumber}
      step={Globals.stepNumber}
      disabled={disabled}
      placeholder={label}
      value={value ?? ""}
      onChange={change}
      onFocus={focus}
      onBlur={blur}
      onKeyUp={keyUp}
    />
  );
};

export const StockInput: React.FC<{
  readOnly?: boolean;
  product: Product;
  storage: Storage;
}> = ({ readOnly, product, storage }) => {
  const strings = useStrings();
  const [subFocused, setSubFocused] = useState(false);
  const [addFocused, setAddFocused] = useState(false);
  const [subValue, setSubValue] = useState<number | undefined>();
  const [addValue, setAddValue] = useState<number | undefined>();
  const subButtonRef = useRef<HTMLButtonElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const invokeSub = useCallback(
    () =>
      invokeWithSync("stock", "POST", {
        productId: product.id,
        storageId: storage.id,
        delta: -(subValue ?? 0),
      }).then(() => setSubValue(undefined)),
    [product.id, storage.id, subValue]
  );
  const invokeAdd = useCallback(
    () =>
      invokeWithSync("stock", "POST", {
        productId: product.id,
        storageId: storage.id,
        delta: addValue ?? 0,
      }).then(() => setAddValue(undefined)),
    [product.id, storage.id, addValue]
  );
  const [subing, subClick] = useProgress(invokeSub);
  const [adding, addClick] = useProgress(invokeAdd);
  const value = useLiveQuery(async () => {
    const stock = await Database.instance.stock
      .where(["productId", "storageId"])
      .equals([product.id, storage.id])
      .first();
    return stock === undefined ? 0 : stock.value;
  }, [product.id, storage.id]);
  const disabled = subing || adding || readOnly || value === undefined;

  return (
    <InputGroup>
      {value !== undefined && subValue !== undefined && (
        <Button
          ref={subButtonRef}
          variant={calcVariant(subValue, subFocused)}
          disabled={disabled || Number.isNaN(subValue)}
          onClick={subClick}
        >
          <ProgressSpan active={subing}>
            = {strings.label.quantity(value - subValue, product.stockUnit)}
          </ProgressSpan>
        </Button>
      )}
      <StockControl
        disabled={disabled}
        label={strings.button.decreaseStock}
        value={subValue}
        setValue={setSubValue}
        setFocused={setSubFocused}
        buttonRef={subButtonRef}
      />
      <InputGroup.Text>-</InputGroup.Text>
      <InputGroup.Text>
        {value === undefined ? (
          <InlineSpinner />
        ) : (
          strings.label.quantity(value, product.stockUnit)
        )}
      </InputGroup.Text>
      <InputGroup.Text>+</InputGroup.Text>
      <StockControl
        disabled={disabled}
        label={strings.button.increaseStock}
        value={addValue}
        setValue={setAddValue}
        setFocused={setAddFocused}
        buttonRef={addButtonRef}
      />
      {value !== undefined && addValue !== undefined && (
        <Button
          ref={addButtonRef}
          variant={calcVariant(addValue, addFocused)}
          disabled={disabled || Number.isNaN(addValue)}
          onClick={addClick}
        >
          <ProgressSpan active={adding}>
            = {strings.label.quantity(value + addValue, product.stockUnit)}
          </ProgressSpan>
        </Button>
      )}
    </InputGroup>
  );
};
