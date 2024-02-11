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

import { Providers } from "@microsoft/mgt-element";
import { Database } from "./db";
import { InvalidResultError, InvalidTypeError } from "./errors";
import { Globals } from "./globals";

export type ObjectApi = "product" | "storage";
export type ObjectMethod = "PUT" | "POST" | "DELETE";

export type PermissionApi = "productPermission" | "storagePermission";
export type PermissionMethod = "PUT" | "DELETE";

type SyncApi = ObjectApi | PermissionApi | "stock";
type SyncMethod = ObjectMethod | PermissionMethod | "POST";

export const invoke = async (
  api: SyncApi | "changes" | "sync",
  method: SyncMethod | "GET",
  body?: object
): Promise<any> => {
  const idToken = (Providers.globalProvider as any).getAccount().idToken;
  if (typeof idToken !== "string") {
    throw new InvalidTypeError("idToken", idToken, "string");
  }
  const response = await fetch(`${Globals.apiUrl}?${api}`, {
    method,
    headers: {
      "X-ID-TOKEN": idToken,
      ...(body === undefined
        ? undefined
        : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  if (json === null || typeof json !== "object") {
    throw new InvalidTypeError("json", json, "object");
  }
  if (json["result"] === "FAILED") {
    throw new Error(json["reason"]);
  }
  return json;
};

export const invokeWithSync = async (
  api: SyncApi,
  method: SyncMethod,
  body: object
): Promise<void> => {
  const response = await invoke(api, method, body);
  if (response["result"] !== "SUCCEEDED") {
    throw new InvalidResultError(response["result"]);
  }
  await Database.syncDownstream();
};
