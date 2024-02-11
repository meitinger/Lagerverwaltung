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
  useEffect,
  useMemo,
  useState,
} from "react";
import { ObjectApi, ObjectMethod, PermissionApi } from "./api";
import { Objects, Product, Storage, SyncState } from "./db";
import {
  FieldNotInFormDataError,
  InvalidResultError,
  InvalidTypeError,
  LocalDatabaseChangesError,
  MissingConfigurationError,
  MissingContextError,
  OperationInProgressError,
  SyncUrlMismatchError,
} from "./errors";

export type Language = "de" | "en";

const currency: Intl.NumberFormatOptions = {
  style: "currency",
  currency: "EUR",
};

const percent: Intl.NumberFormatOptions = { style: "percent" };

const unit = (code: string, singular: string, plural?: string) =>
  Object.freeze({
    code,
    label: `${singular}${
      plural === undefined
        ? ""
        : plural.length > 2
        ? `/${plural}`
        : `(${plural})`
    } [${code}]`,
    singular,
    plural:
      plural === undefined
        ? singular
        : plural.length > 2
        ? plural
        : singular + plural,
  });

const apis = {
  de: {
    product: "Produkt",
    productGroup: "Produktgruppe",
    productPermission: "Produktberechtigung",
    stock: "Lagerstand",
    storage: "Lager",
    storagePermission: "Lagerberechtigung",
  },
  en: {
    product: "product",
    productGroup: "product group",
    productPermission: "product permission",
    stock: "stock",
    storage: "storage",
    storagePermission: "storage permission",
  },
};

const buttons = {
  de: {
    cancel: "Abbrechen",
    connectDatabase: "Datenbank periodisch synchronisieren",
    decreaseStock: "Abbuchen",
    delete: "Entfernen",
    disconnectDatabase: "Periodische Synchronisierung anhalten",
    generateBarcode: "Barcode erstellen",
    globalPermissions: "Globale Berechtigungen",
    increaseStock: "Zubuchen",
    language: "DE",
    login: "Anmelden",
    modify: "Bearbeiten",
    newPermission: "Neue Berechtigung",
    newProduct: "Neuer Artikel",
    newStorage: "Neues Lager",
    ok: "OK",
    permissions: "Berechtigungen",
    reloadApp: "Anwendung neustarten",
    resetDatabase: "Lokale Datenbank zurücksetzen",
    stock: "Lagerbestände",
    syncDownstreamDatabase:
      "Lokale Datenbank mit Server-Datenbank synchronisieren",
    syncUpstreamDatabase: "Server-Datenbank mit ready2order synchronisieren",
  },
  en: {
    cancel: "Cancel",
    connectDatabase: "Auto-sync local database",
    decreaseStock: "Decrease",
    delete: "Delete",
    disconnectDatabase: "Stop auto-syncing of local database",
    generateBarcode: "Generate Barcode",
    globalPermissions: "Global Permissions",
    increaseStock: "Increase",
    language: "EN",
    login: "Login",
    modify: "Modify",
    newPermission: "New Permission",
    newProduct: "New Product",
    newStorage: "New Storage",
    ok: "OK",
    permissions: "Permissions",
    reloadApp: "Reload App",
    resetDatabase: "Reset local database",
    stock: "Stock",
    syncDownstreamDatabase: "Sync local database with server database",
    syncUpstreamDatabase: "Sync server database with ready2order",
  },
};

const columns = {
  de: {
    addProducts: "Artikel hinzufügen",
    barcode: "Strichcode",
    listProducts: "Produkte auflisten",
    manage: "Verwalten",
    name: "Bezeichnung",
    permissions: "Berechtigungen",
    permissionCount: "Anzahl Berechtigungen",
    price: "Preis",
    product: "Artikel",
    productCount: "Anzahl Artikel",
    productGroup: "Produktgruppe",
    properties: "Eigenschaften",
    removeProducts: "Artikel entfernen",
    status: "Status",
    stock: "Lagerbestand",
    storeStock: "Lager Kasse",
    user: "Benutzer_in",
  },
  en: {
    addProducts: "Add Products",
    barcode: "Barcode",
    listProducts: "List Products",
    manage: "Manage",
    name: "Name",
    permissions: "Permissions",
    permissionCount: "# of Permissions",
    price: "Price",
    product: "Product",
    productCount: "# of Products",
    productGroup: "Product Group",
    properties: "Properties",
    status: "Status",
    stock: "Stock",
    storeStock: "Store Stock",
    removeProducts: "Delete Products",
    user: "User",
  },
};

const emptyOptions = {
  de: {
    groupId: "(Keine Produktgruppe)",
    stockUnit: "(keine Angabe)",
    typeId: "(Wie Produktgruppe)",
  },
  en: {
    groupId: "(no product group)",
    stockUnit: "(no unit)",
    typeId: "(as product group)",
  },
};

const fields = {
  de: {
    id: "ID",
    groupId: "Produktgruppe",
    externalReference: "Externe Referenz",
    itemNumber: "Artikelnummer",
    barcode: "Strichcode",
    name: "Name",
    description: "Beschreibung",
    price: "Bruttopreis",
    priceIncludesVat: "USt. anzeigen",
    vat: "Umsatzsteuer",
    customPrice: "Manuelle Preiseingabe",
    customQuantity: "Mengeneingabe aktiviert",
    fav: "In Favoriten anzeigen",
    highlight: "Hervorheben",
    expressMode: "Express-Modus",
    stockEnabled: "Lager aktiviert",
    stockValue: "Lagerbestand",
    stockUnit: "Einheit",
    stockReorderLevel: "Meldebestand",
    stockSafetyStock: "Mindestbestand",
    sortIndex: "Sortierreihenfolge",
    soldOut: "Ausverkauft",
    active: "Aktiviert",
    sideDishOrder: "Beilage",
    discountable: "Rabattfähig",
    accountingCode: "Kontonummer",
    colorClass: "Farbe",
    typeId: "Produktart",
    createdAt: "Erstellt am",
    updatedAt: "Geändert am",
    alternativeNameOnReceipts: "Bezeichnung auf Rechnung",
    alternativeNameInPos: "Bezeichnung in Kassenoberfläche",
    productionCosts: "Herstellungskosten",
  },
  en: {
    id: "id",
    groupId: "product group",
    externalReference: "external reference",
    itemNumber: "item number",
    barcode: "barcode",
    name: "name",
    description: "description",
    price: "gross price",
    priceIncludesVat: "show tax",
    vat: "tax",
    customPrice: "manual price",
    customQuantity: "custom quantity",
    fav: "show in favorites",
    highlight: "highlight",
    expressMode: "express modus",
    stockEnabled: "stock enabled",
    stockValue: "stock",
    stockUnit: "unit",
    stockReorderLevel: "reorder level",
    stockSafetyStock: "safety stock",
    sortIndex: "sort order",
    soldOut: "sold out",
    active: "activated",
    sideDishOrder: "side dish order",
    discountable: "discountable",
    accountingCode: "accounting code",
    colorClass: "color",
    typeId: "product type",
    createdAt: "created at",
    updatedAt: "updated at",
    alternativeNameOnReceipts: "label on invoice",
    alternativeNameInPos: "name in POS app",
    productionCosts: "production costs",
  },
};

const fieldSets = {
  de: {
    actions: "Aktionen",
    general: "Allgemein",
    price: "Preis",
    status: "Status",
    stock: "Lager",
    pos: "Kasse",
    accounting: "Buchhaltung",
    advanced: "Erweitert",
  },
  en: {
    actions: "Actions",
    general: "General",
    price: "Price",
    status: "Status",
    stock: "Stock",
    pos: "POS",
    accounting: "Accounting",
    advanced: "Advanced",
  },
};

const formatErrors = {
  de: (error: any): string => {
    if (error instanceof FieldNotInFormDataError) {
      return `'${error.name}' ist kein Formularfeld.`;
    }
    if (error instanceof InvalidResultError) {
      return `Ungültige Serverantwort '${error.result}', 'FAILED' oder 'SUCCEEDED' erwartet.`;
    }
    if (error instanceof InvalidTypeError) {
      return `'${error.name}' hat den Typ '${error.type}', es wurde aber '${error.expectedType}' erwartet.`;
    }
    if (error instanceof LocalDatabaseChangesError) {
      return "Es wurden lokale Änderungen gefunden. Versuchen Sie die lokale Datenbank zurückzusetzen.";
    }
    if (error instanceof MissingConfigurationError) {
      return `Konfiguration ${
        error.option === undefined ? "" : `für '${error.option}'`
      } fehlt.`;
    }
    if (error instanceof MissingContextError) {
      return `Es wurde keine '${error.name}'-Umgebung gefunden.`;
    }
    if (error instanceof OperationInProgressError) {
      return "Ein anderer Vorgang wird bereits ausgeführt.";
    }
    if (error instanceof SyncUrlMismatchError) {
      return `Bei der Synchronisierung wurde URL '${error.url}' angegeben, '${error.expectedUrl}' erwartet.`;
    }
    return formatError(error, "Ein unbekannter Fehler ist aufgetreten.");
  },
  en: (error: any): string => {
    if (error instanceof FieldNotInFormDataError) {
      return `Field '${error.name}' is not contained in the form data.`;
    }
    if (error instanceof InvalidResultError) {
      return `API result '${error.result}' is not valid, expected 'FAILED' or 'SUCCEEDED'`;
    }
    if (error instanceof InvalidTypeError) {
      return `Value '${error.name}' is of type '${error.type}', expected '${error.expectedType}'.`;
    }
    if (error instanceof LocalDatabaseChangesError) {
      return "Local data was changed unexpectedly.\nTry resetting the local database.";
    }
    if (error instanceof MissingConfigurationError) {
      return `Configuration ${
        error.option === undefined ? "" : `for option '${error.option}'`
      } is missing.`;
    }
    if (error instanceof MissingContextError) {
      return `React context '${error.name}' is not present.`;
    }
    if (error instanceof OperationInProgressError) {
      return "Operation is already in progress.";
    }
    if (error instanceof SyncUrlMismatchError) {
      return `Sync was invoked with url '${error.url}', expected '${error.expectedUrl}'.`;
    }
    return formatError(error, "Unknown error occurred.");
  },
};

const greetings = {
  de: (
    <>
      Willkommen bei der Lagerverwaltung.
      <br />
      Bitte melden Sie sich mit Ihrem Azure AD Account an.
    </>
  ),
  en: (
    <>
      Welcome to the storage management system.
      <br />
      Please log on using your Azure AD account.
    </>
  ),
};

const labels = {
  de: {
    addProductsPermission: "Artikel anlegen oder dieser Produktgruppe zuweisen",
    allProductGroups: "(Alle Produktgruppen)",
    appError: "Ein unerwarteter Fehler ist aufgetreten.",
    booleanState: (value: boolean): string => (value ? "✔" : "❌"),
    customPrice: "Manuelle Eingabe",
    database: (state: SyncState): string => {
      switch (state) {
        case SyncState.ERROR:
        case SyncState.ERROR_WILL_RETRY:
          return "DB [Fehler]";
        case SyncState.OFFLINE:
          return "DB [Sync AUS]";
        case SyncState.CONNECTING:
          return "DB [Initialisierung]";
        case SyncState.ONLINE:
        case SyncState.SYNCING:
          return "DB [Sync AN]";
      }
    },
    language: "Deutsch",
    listProductsPermission: "Artikel auflisten und in Lagerorten anzeigen",
    listStoragePermission: "Lager und dessen Artikelstände anzeigen",
    stockDeactivated: "Keine Lagerführung",
    stockStoragePermission: "Lagerbuchungen durchführen",
    price: (value: number, vat?: number): string =>
      `${value.toLocaleString("de", currency)} ${
        vat === undefined
          ? " exkl. USt."
          : ` inkl. ${vat.toLocaleString("de", percent)} USt.`
      }`,
    productionCosts: (value: number): string =>
      `Herstellung: ${value.toLocaleString("de", currency)}`,
    productSoldOut: "Ausverkauft",
    quantity: (
      value: number,
      unit: string | null,
      format: "short" | "long" = "short"
    ): string => formatUnit("de", value, unit, format),
    removeProductsPermission:
      "Artikel löschen oder einer anderen Produktgruppe zuweisen",
    stackTrace: "Stapelzurückverfolgung:",
    type: (type: number): string =>
      `Typ: ${
        (productTypes.de as { [id: number]: string })[type] ??
        `Unbekannt (${type})`
      }`,
  },
  en: {
    addProductsPermission:
      "create new products or assign them to this product group",
    allProductGroups: "(all product groups)",
    appError: "An unexpected application error occured.",
    booleanState: (value: boolean): string => (value ? "✔" : "❌"),
    customPrice: "manual entry",
    database: (state: SyncState): string => {
      switch (state) {
        case SyncState.ERROR:
        case SyncState.ERROR_WILL_RETRY:
          return "DB [Error]";
        case SyncState.OFFLINE:
          return "DB [Sync OFF]";
        case SyncState.CONNECTING:
          return "DB [Initialising]";
        case SyncState.ONLINE:
        case SyncState.SYNCING:
          return "DB [Sync ON]";
      }
    },
    language: "English",
    listProductsPermission: "list products and show them in storage lists",
    listStoragePermission: "display storage in list and show its content",
    stockDeactivated: "stock deactivated",
    stockStoragePermission: "increase and decrease storage stock",
    price: (value: number, vat?: number): string =>
      `${value.toLocaleString("en", currency)} ${
        vat === undefined
          ? " excl. VAT"
          : ` incl. ${vat.toLocaleString("en", percent)} VAT`
      }`,
    productionCosts: (value: number): string =>
      `Production: ${value.toLocaleString("en", currency)}`,
    productSoldOut: "sold out",
    quantity: (
      value: number,
      unit: string | null,
      format: "short" | "long" = "short"
    ): string => formatUnit("en", value, unit, format),
    removeProductsPermission:
      "delete products or assign them to a different product group",
    stackTrace: "Stack Trace:",
    type: (type: number): string =>
      `type: ${
        (productTypes.en as { [id: number]: string })[type] ??
        `unknown (${type})`
      }`,
  },
};

const messages = {
  de: {
    confirmDeletion: (api: ObjectApi, object: Objects): string =>
      `${apis.de[api]} "${object.name}" wirklich löschen?`,
    discardChanges: "Änderungen verwerfen?",
    syncDownstreamResult: (changes: number): string =>
      `Es wurden ${changes} Änderung(en) vom Server synchronisiert.`,
    syncUpstreamResult: (changes: {
      numberOfProductGroups: number;
      numberOfProducts: number;
    }): string =>
      `Es wurden ${changes.numberOfProductGroups} Produktgruppe(n) und ${changes.numberOfProducts} Produkt(e) synchonisiert.`,
  },
  en: {
    confirmDeletion: (api: ObjectApi, object: Objects): string =>
      `Really delete ${apis.en[api]} "${object.name}"?`,
    discardChanges: "Discard changes?",
    syncDownstreamResult: (changes: number): string =>
      `${changes} changes have been synced from the server.`,
    syncUpstreamResult: (changes: {
      numberOfProductGroups: number;
      numberOfProducts: number;
    }): string =>
      `${changes.numberOfProductGroups} product group(s) and ${changes.numberOfProducts} produkt(s) have been synced.`,
  },
};

const methods = {
  de: {
    PUT: "erstellen",
    POST: "ändern",
    DELETE: "löschen",
  },
  en: {
    PUT: "create",
    POST: "update",
    DELETE: "delete",
  },
};

const productTypes = {
  de: {
    1: "Speise",
    2: "Getränk",
    3: "Beilage",
    4: "Extra",
    5: "Variante",
    6: "Bestandteil",
    7: "Standard",
    8: "Rabatt",
    9: "Gutschein-Einlöse",
    10: "Gutscheinverkauf",
    11: "Cocktail",
    12: "Nachricht",
    13: "Trinkgeld",
    15: "Rundung",
    16: "Einzweckgutschein-Einlöse",
    17: "Mehrzweckgutschein",
    18: "Einzweckgutschein",
    19: "Pfand",
    20: "Pfandrückzahlung",
  },
  en: {
    1: "food",
    2: "beverage",
    3: "sidedish",
    4: "extra",
    5: "variation",
    6: "ingredient",
    7: "standard",
    8: "discount",
    9: "coupon redemption",
    10: "coupon sale",
    11: "cocktail",
    12: "message",
    13: "tip",
    15: "rounding",
    16: "single-purpose redemption",
    17: "multi-purpose coupon",
    18: "single-purpose coupon",
    19: "deposit sale",
    20: "deposit return",
  },
};

const titles = {
  de: {
    main: "Lagerverwaltung",
    objectDialog: (
      api: ObjectApi,
      method: ObjectMethod,
      obj: Objects
    ): string => `${apis.de[api]} ${obj.name} ${methods.de[method]}`,
    permissions: "Berechtigungen",
    permissionDialog: (api: PermissionApi, obj?: Objects): string =>
      obj === undefined
        ? `Globale ${apis.de[api]}en`
        : `${apis.de[api]}en für ${obj.name}`,
    products: "Artikelliste",
    productStockDialog: (product: Product): string =>
      `Lagerstände für ${product.name}`,
    storages: "Lagerübersicht",
    storageStockDialog: (storage: Storage): string =>
      `Artikel in Lager ${storage.name}`,
  },
  en: {
    main: "Storage Management",
    objectDialog: (
      api: ObjectApi,
      method: ObjectMethod,
      obj: Objects
    ): string =>
      `${methods.en[method].charAt(0).toUpperCase()}${methods.en[
        method
      ].substring(1)} ${apis.en[api]} ${obj.name}`,
    permissions: "Permissions",
    permissionDialog: (api: PermissionApi, obj?: Objects): string =>
      obj === undefined
        ? `Global ${apis.en[api]}s`
        : `${apis.en[api].charAt(0).toUpperCase()}${apis.en[api].substring(
            1
          )}s for ${obj.name}`,
    products: "Products",
    productStockDialog: (product: Product): string =>
      `Stock of ${product.name}`,
    storages: "Storages",
    storageStockDialog: (storage: Storage): string =>
      `Stock in Storage ${storage.name}`,
  },
};

const units = {
  de: {
    piece: unit("stk", "Stück"),
    kilo: unit("kg", "Kilo"),
    hours: unit("h", "Stunde", "n"),
    liter: unit("l", "Liter"),
    centiliter: unit("cl", "Centiliter"),
    qm: unit("m3", "Kubikmeter"),
    m2: unit("m2", "Quadratmeter"),
    meter: unit("m", "Meter"),
    gram: unit("g", "Gramm"),
    ton: unit("t", "Tonne", "n"),
    milliliter: unit("ml", "Milliliter"),
    schuettraummeter: unit("srm", "Schüttraummeter"),
    raummeter: unit("rm", "Raummeter"),
    beutel: unit("Btl", "Beutel"),
    can: unit("Ds", "Dose", "n"),
    palette: unit("Pal", "Palette", "n"),
    karton: unit("Krt", "Karton", "s"),
    bottle: unit("Fl", "Flasche", "n"),
    sack: unit("Sak", "Sack", "Säcke"),
    pair: unit("Paar", "Paar"),
  },
  en: {
    piece: unit("pc", "piece", "s"),
    kilo: unit("kg", "kilo", "s"),
    hours: unit("h", "hour", "s"),
    liter: unit("l", "liter", "s"),
    centiliter: unit("cl", "centiliter", "s"),
    qm: unit("m3", "cubic meter", "s"),
    m2: unit("m2", "square meter", "s"),
    meter: unit("m", "meter", "s"),
    gram: unit("g", "gram", "s"),
    ton: unit("t", "ton", "s"),
    milliliter: unit("ml", "milliliter", "s"),
    schuettraummeter: unit("bcm", "bulk cubic meter", "s"),
    raummeter: unit("rm", "cubic room meter", "s"),
    beutel: unit("bag", "bag", "s"),
    can: unit("can", "can", "s"),
    palette: unit("pal", "pallet", "s"),
    karton: unit("box", "box", "es"),
    bottle: unit("bt", "bottle", "s"),
    sack: unit("sac", "sack", "s"),
    pair: unit("pr", "pair", "s"),
  },
};

const buildLanguage = (language: Language) =>
  Object.freeze({
    button: freezeSection(buttons, language),
    collator: new Intl.Collator(language, {
      sensitivity: "base",
      numeric: true,
    }),
    column: freezeSection(columns, language),
    emptyOption: freezeSection(emptyOptions, language),
    field: freezeSection(fields, language),
    fieldSet: freezeSection(fieldSets, language),
    formatError: formatErrors[language],
    greeting: greetings[language],
    label: freezeSection(labels, language),
    language,
    message: freezeSection(messages, language),
    title: freezeSection(titles, language),
    productType: freezeSection(productTypes, language),
    unit: freezeSection(units, language),
  });

const formatError = (error: any, noMessage: string): string => {
  if (error instanceof Error) {
    return error.message.length === 0 ? noMessage : error.message;
  }
  if (typeof error === "string") {
    return error.length === 0 ? noMessage : error;
  }
  return noMessage;
};

const formatUnit = (
  language: Language,
  value: number,
  unit: string | null,
  format: "short" | "long"
): string => {
  const quantity = value.toLocaleString(language);
  if (unit === null) {
    return `${quantity}x`;
  }
  const unitsMap = units[language] as {
    [id: string]: { code: string; singular: string; plural: string };
  };
  if (!(unit in unitsMap)) {
    return `${quantity} ${unit}`;
  }
  const template = unitsMap[unit];
  switch (format) {
    case "short":
      return `${quantity} ${template.code}`;
    case "long":
      return `${quantity} ${value === 1 ? template.singular : template.plural}`;
  }
};

const freezeSection = <T,>(
  translations: Readonly<{ [lang in Language]: T }>,
  language: Language
): Readonly<T> => Object.freeze(translations[language]);

const getPreferredLanguage = (): Language => {
  const storedLanguageCode = window.localStorage.getItem(localStorageItemName);
  for (const language of languages) {
    if (storedLanguageCode?.toLowerCase() === language) {
      return language;
    }
  }
  for (const browserLanguageCode of window.navigator.languages.map(
    (languageCode) => languageCode.toLowerCase()
  )) {
    for (const language of languages) {
      if (
        browserLanguageCode === language ||
        browserLanguageCode.startsWith(`${language}-`)
      ) {
        return language;
      }
    }
  }
  return "de";
};

const localStorageItemName = "language";

export const strings = Object.freeze({
  de: buildLanguage("de"),
  en: buildLanguage("en"),
});

export const languages = Object.freeze(Object.keys(strings)) as Language[];

const Context = createContext(
  Object.freeze({
    ...strings[getPreferredLanguage()],
    setLanguage: (language: Language): void => {
      throw new MissingContextError("Strings");
    },
  })
);

export const useStrings = () => useContext(Context);

export const StringsContext: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const [language, setLanguageInternal] = useState(getPreferredLanguage());
  const setLanguage = useCallback((language: Language): void => {
    setLanguageInternal(language);
    window.localStorage.setItem(localStorageItemName, language);
  }, []);
  const context = useMemo(
    () =>
      Object.freeze({
        ...strings[language],
        setLanguage,
      }),
    [language, setLanguage]
  );
  useEffect(() => {
    window.document.title = context.title.main;
  }, [context]);

  return <Context.Provider value={context}>{children}</Context.Provider>;
};
