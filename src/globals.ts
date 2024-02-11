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

import { Product, Storage } from "./db";
import { InvalidTypeError, MissingConfigurationError } from "./errors";

const getBoolean = (name: string, defaultValue: boolean = false): boolean =>
  getValue<boolean>(name, "boolean") ?? defaultValue;

const getMandatory = <T>(
  name: string,
  getter: (name: string) => T | null
): T => {
  const result = getter(name);
  if (result === null) {
    throw new MissingConfigurationError(name);
  }
  return result;
};

const getNumber = (name: string): number =>
  getMandatory(name, getOptionalNumber);

const getOptionalNumber = (name: string): number | null =>
  getValue<number>(name, "number");

const getOptionalString = (name: string): string | null =>
  getValue<string>(name, "string");

const getString = (name: string): string =>
  getMandatory(name, getOptionalString);

const getValue = <T>(
  name: string,
  type: "string" | "number" | "boolean"
): T | null => {
  if (!("config" in window)) {
    throw new MissingConfigurationError();
  }
  const config = window["config"];
  if (typeof config !== "object" || config === null) {
    throw new InvalidTypeError("config", config, "object");
  }
  if (!(name in config)) {
    return null;
  }
  const value = (config as any)[name];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== type) {
    throw new InvalidTypeError(`config.${name}`, value, type);
  }
  return value as T;
};

export class Globals {
  private static _defaultProduct: Product | null = null;
  private static _defaultStorage: Storage | null = null;

  public static get apiUrl(): string {
    return getString("api_endpoint");
  }

  public static get clientId(): string {
    return getString("auth_client");
  }

  public static get databaseName(): string {
    return getString("sync_database");
  }

  public static get defaultProduct(): Product {
    return (Globals._defaultProduct ??= Object.freeze({
      id: "*",
      groupId: "*",
      externalReference: getOptionalString("product_externalReference"),
      itemNumber: getOptionalString("product_itemnumber"),
      barcode: getOptionalString("product_barcode"),
      name: getString("product_name"),
      description: getOptionalString("product_description"),
      price: getNumber("product_price"),
      priceIncludesVat: getBoolean("product_priceIncludesVat", true),
      vat: getNumber("product_vat"),
      customPrice: getBoolean("product_customPrice"),
      customQuantity: getBoolean("product_customQuantity"),
      fav: getBoolean("product_fav"),
      highlight: getBoolean("product_highlight"),
      expressMode: getBoolean("product_expressMode"),
      stockEnabled: getBoolean("product_stock_enabled"),
      stockValue: getNumber("product_stock_value"),
      stockUnit: getOptionalString("product_stock_unit"),
      stockReorderLevel: getOptionalNumber("product_stock_reorderLevel"),
      stockSafetyStock: getOptionalNumber("product_stock_safetyStock"),
      sortIndex: 0,
      active: getBoolean("product_active", true),
      soldOut: getBoolean("product_soldOut"),
      sideDishOrder: getBoolean("product_sideDishOrder"),
      discountable: getBoolean("product_discountable", true),
      accountingCode: getOptionalString("product_accountingCode"),
      colorClass: null,
      typeId: getOptionalNumber("product_type_id"),
      createdAt: "",
      updatedAt: "",
      alternativeNameOnReceipts: getOptionalString(
        "product_alternativeNameOnReceipts"
      ),
      alternativeNameInPos: getOptionalString("product_alternativeNameInPos"),
      productionCosts: null,
    }));
  }

  public static get defaultStorage(): Storage {
    return (Globals._defaultStorage ??= Object.freeze({
      id: "*",
      name: "",
      active: true,
    }));
  }

  public static readonly maxNumber = "999999999999999.99999";

  public static readonly minNumber = "-999999999999999.99999";

  public static readonly stepNumber = "0.00001";

  public static get tenantId(): string {
    return getString("auth_tenant");
  }

  public static get syncInterval(): number {
    return getNumber("sync_interval");
  }

  public static get syncProtocolName(): string {
    return getString("sync_protocol");
  }
}
