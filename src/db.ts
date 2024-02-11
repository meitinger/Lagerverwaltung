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

import Dexie, { Table } from "dexie";
import "dexie-observable";
import { IDatabaseChange } from "dexie-observable/api";
import "dexie-syncable";
import {
  ApplyRemoteChangesFunction,
  IPersistedContext,
  ISyncProtocol,
  PollContinuation,
  ReactiveContinuation,
} from "dexie-syncable/api";
import { useEffect, useState } from "react";
import { invoke } from "./api";
import {
  InvalidTypeError,
  LocalDatabaseChangesError,
  SyncUrlMismatchError,
} from "./errors";
import { Globals } from "./globals";

export type Changelog = Readonly<{
  id: string;
  userId: string;
  change: IDatabaseChange;
  time: Date;
}>;

export type ProductGroup = Readonly<{
  id: string;
  parentId: string; // null => "*"
  name: string;
  description: string | null;
  shortcut: string | null;
  active: boolean;
  sortIndex: number;
  accountingCode: string | null;
  typeId: number | null;
  createdAt: string;
  updatedAt: string;
}>;

export type Product = Readonly<{
  id: string;
  groupId: string; // null => "*"
  externalReference: string | null;
  itemNumber: string | null;
  barcode: string | null;
  name: string;
  description: string | null;
  price: number;
  priceIncludesVat: boolean;
  vat: number;
  customPrice: boolean;
  customQuantity: boolean;
  fav: boolean;
  highlight: boolean;
  expressMode: boolean;
  stockEnabled: boolean;
  stockValue: number;
  stockUnit: string | null;
  stockReorderLevel: number | null;
  stockSafetyStock: number | null;
  sortIndex: number;
  active: boolean;
  soldOut: boolean;
  sideDishOrder: boolean;
  discountable: boolean;
  accountingCode: string | null;
  colorClass: string | null;
  typeId: number | null;
  createdAt: string;
  updatedAt: string;
  alternativeNameOnReceipts: string | null;
  alternativeNameInPos: string | null;
  productionCosts: number | null;
}>;

export type ProductPermission = Readonly<{
  id: string;
  groupId: string; // null => "*"
  userId: string;
  add: boolean;
  remove: boolean;
  properties: string;
}>;

export type Storage = Readonly<{
  id: string;
  name: string;
  active: boolean;
}>;

export type StoragePermission = Readonly<{
  id: string;
  storageId: string; // null => "*"
  userId: string;
  stock: boolean;
}>;

export type Stock = Readonly<{
  id: string;
  productId: string;
  storageId: string;
  value: number;
}>;

export type Objects = Product | Storage;

export type Permissions = ProductPermission | StoragePermission;

export const enum SyncState {
  ERROR = -1,
  OFFLINE = 0,
  CONNECTING = 1,
  ONLINE = 2,
  SYNCING = 3,
  ERROR_WILL_RETRY = 4,
}

export type SyncStateListener = (state: SyncState) => void;

export class Database extends Dexie implements ISyncProtocol {
  private static _instance: Database | null = null;

  public static get instance(): Database {
    return (Database._instance ??= new Database());
  }

  public static addSyncStateListener(listener: SyncStateListener): void {
    Database.instance.listeners.add(listener);
  }

  public static async connect(): Promise<void> {
    await Database.instance.syncable.connect(
      Globals.syncProtocolName,
      Database.instance.url
    );
  }

  public static async disconnect(): Promise<void> {
    await Database.instance.syncable.disconnect(Database.instance.url);
  }

  public static async getSyncState(): Promise<SyncState> {
    return (await Database.instance.syncable.getStatus(
      Database.instance.url
    )) as unknown as SyncState;
  }

  public static removeSyncStateListener(listener: SyncStateListener): boolean {
    return Database.instance.listeners.delete(listener);
  }

  public static async reset(): Promise<void> {
    await Database.disconnect();
    Database.instance.close();
    await Database.instance.delete();
    window.location.reload();
  }

  public static async syncDownstream(): Promise<number> {
    // connect if not already connected
    if (Database.instance.applyRemoteChanges === undefined) {
      await Database.instance.syncable.connect(
        Globals.syncProtocolName,
        Database.instance.url
      );
    }
    return await Database.instance.syncInternal();
  }

  public static async syncUpstream(): Promise<{
    numberOfProductGroups: number;
    numberOfProducts: number;
  }> {
    const result = await invoke("sync", "GET");
    const numberOfProductGroups = result["numberOfProductGroups"];
    const numberOfProducts = result["numberOfProducts"];
    if (typeof numberOfProductGroups !== "number") {
      throw new InvalidTypeError(
        "numberOfProductGroups",
        numberOfProductGroups,
        "number"
      );
    }
    if (typeof numberOfProducts !== "number") {
      throw new InvalidTypeError(
        "numberOfProducts",
        numberOfProducts,
        "number"
      );
    }
    return {
      numberOfProductGroups,
      numberOfProducts,
    };
  }

  changelog!: Table<Changelog, string>;
  productGroup!: Table<ProductGroup, string>;
  product!: Table<Product, string>;
  productPermission!: Table<ProductPermission, string>;
  storage!: Table<Storage, string>;
  storagePermission!: Table<StoragePermission, string>;
  stock!: Table<Stock, string>;

  private applyRemoteChanges: ApplyRemoteChangesFunction | undefined;
  private readonly listeners = new Set<SyncStateListener>();
  private syncedRevision: number | null | undefined;
  private readonly url: string = `${Globals.apiUrl}?changes`;

  private constructor() {
    super(Globals.databaseName);
    this.version(11).stores({
      changelog: "$$id,userId,[change.table+change.key]",
      productGroup: "$$id,parentId,sortIndex",
      product: "$$id,groupId",
      productPermission: "$$id,groupId,userId,&[groupId+userId]",
      storage: "$$id",
      storagePermission: "$$id,storageId,userId,&[storageId+userId]",
      stock: "$$id,productId,storageId,&[productId+storageId]",
    });
    this.syncable.on("statusChanged", (status, url) => {
      if (this.url === url) {
        this.listeners.forEach((listener) => listener(status));
      }
    });
    Dexie.Syncable.registerSyncProtocol(Globals.syncProtocolName, this);
  }

  private async syncInternal(): Promise<number> {
    // make a snapshot of the current state
    const syncedRevision = this.syncedRevision;
    const applyRemoteChanges = this.applyRemoteChanges;
    if (applyRemoteChanges === undefined) {
      // not connected
      return 0;
    }

    // fetch changes
    const result = await invoke("changes", "POST", { syncedRevision });

    // don't do anything if we disconnected or reconnected
    if (
      this.syncedRevision !== syncedRevision ||
      this.applyRemoteChanges !== applyRemoteChanges
    ) {
      return 0;
    }

    // apply the changes and update the revision
    const changes = result["changes"];
    if (!Array.isArray(changes)) {
      throw new InvalidTypeError("changes", changes, "array");
    }
    const lastRevision = result["lastRevision"];
    if (typeof lastRevision !== "number") {
      throw new InvalidTypeError("lastRevision", lastRevision, "number");
    }
    applyRemoteChanges(changes, lastRevision);
    this.syncedRevision = lastRevision;

    // return the number of changes
    return changes.length;
  }

  sync(
    context: IPersistedContext,
    url: string,
    options: any,
    baseRevision: any,
    syncedRevision: any,
    changes: IDatabaseChange[],
    partial: boolean,
    applyRemoteChanges: ApplyRemoteChangesFunction,
    onChangesAccepted: () => void,
    onSuccess: (continuation: PollContinuation | ReactiveContinuation) => void,
    onError: (error: any, again?: number | undefined) => void
  ): void {
    const react = (
      changes: IDatabaseChange[],
      baseRevision: any,
      partial: boolean,
      onChangesAccepted: () => void
    ): void => {
      if (changes.length > 0) {
        throw new LocalDatabaseChangesError();
      }
      onChangesAccepted();
    };
    if (url !== this.url) {
      throw new SyncUrlMismatchError(url, this.url);
    }
    if (syncedRevision !== null && typeof syncedRevision !== "number") {
      throw new InvalidTypeError("syncedRevision", syncedRevision, "number");
    }
    react(changes, baseRevision, partial, onChangesAccepted);
    this.syncedRevision = syncedRevision;
    this.applyRemoteChanges = applyRemoteChanges;
    const interval = setInterval(
      () => this.syncInternal().catch(onError),
      Globals.syncInterval
    );
    onSuccess({
      react,
      disconnect: () => {
        this.syncedRevision = undefined;
        this.applyRemoteChanges = undefined;
        clearInterval(interval);
      },
    });
  }
}

export const useSyncState = (): SyncState => {
  const [syncState, setSyncState] = useState(SyncState.OFFLINE);

  useEffect(() => {
    Database.addSyncStateListener(setSyncState);
    Database.getSyncState()
      .then(setSyncState)
      .catch(() => setSyncState(SyncState.ERROR));

    return () => {
      Database.removeSyncStateListener(setSyncState);
    };
  }, []);

  return syncState;
};
