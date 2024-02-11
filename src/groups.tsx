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
import React, { createContext, useContext, useMemo } from "react";
import { useAuth } from "./auth";
import { CenteredSpinner } from "./common";
import { Database, ProductGroup, ProductPermission } from "./db";

export type EffectivProductGroup = {
  object: ProductGroup | undefined;
  id: string;
  fullName: string;
  active: boolean;
  hasPermission: boolean;
  addProduct: boolean;
  removeProduct: boolean;
  editProductProperties: ReadonlySet<string>;
};

const Context = createContext<
  ReadonlyMap<string, Readonly<EffectivProductGroup>>
>(new Map<string, EffectivProductGroup>());

export const useGroups = () => useContext(Context);

export const GroupsContext: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const { userId } = useAuth();
  const allGroups = useLiveQuery(
    async () =>
      Object.freeze(
        await Database.instance.productGroup.orderBy("sortIndex").toArray()
      ),
    []
  );
  const permissionsByGroupId = useLiveQuery(async () => {
    if (userId === undefined) {
      return undefined;
    }
    const result = new Map<string, ProductPermission>();
    await Database.instance.productPermission
      .where("userId")
      .equals(userId)
      .each((permission) => result.set(permission.groupId, permission));
    return Object.freeze(result);
  }, [userId]);
  const groups = useMemo(() => {
    if (allGroups === undefined || permissionsByGroupId === undefined) {
      return undefined;
    }
    const groupsByParentId = new Map<string, ProductGroup[]>();
    for (const group of allGroups) {
      const subGroups = groupsByParentId.get(group.parentId);
      if (subGroups === undefined) {
        groupsByParentId.set(group.parentId, [group]);
      } else {
        subGroups.push(group);
      }
    }
    const result = new Map<string, Readonly<EffectivProductGroup>>();
    const addGroup = (
      group: Readonly<{
        object: ProductGroup | undefined;
        id: string;
        fullName: string;
        active: boolean;
      }>,
      parent: Readonly<{
        hasPermission: boolean;
        addProduct: boolean;
        removeProduct: boolean;
        editProductProperties: ReadonlySet<string>;
      }>
    ): void => {
      const permission = permissionsByGroupId.get(group.id);
      const effectiveGroup = Object.freeze<EffectivProductGroup>({
        ...(permission === undefined
          ? parent
          : {
              hasPermission: true,
              addProduct: parent.addProduct || permission.add,
              removeProduct: parent.removeProduct || permission.remove,
              editProductProperties: Object.freeze(
                new Set<string>([
                  ...parent.editProductProperties,
                  ...permission.properties
                    .split(",")
                    .filter((v) => v.length > 0),
                ])
              ),
            }),
        ...group,
      });
      result.set(effectiveGroup.id, effectiveGroup);
      const subGroups = groupsByParentId.get(effectiveGroup.id);
      if (subGroups !== undefined) {
        for (const productGroup of subGroups) {
          addGroup(
            {
              object: productGroup,
              id: productGroup.id,
              fullName:
                effectiveGroup.fullName.length === 0
                  ? productGroup.name
                  : `${effectiveGroup.fullName}/${productGroup.name}`,
              active: effectiveGroup.active && productGroup.active,
            },
            effectiveGroup
          );
        }
      }
    };
    addGroup(
      {
        object: undefined,
        id: "*",
        fullName: "",
        active: true,
      },
      {
        hasPermission: false,
        addProduct: false,
        removeProduct: false,
        editProductProperties: Object.freeze(new Set<string>()),
      }
    );
    return Object.freeze(result);
  }, [allGroups, permissionsByGroupId]);
  return (
    <>
      {groups === undefined ? (
        <CenteredSpinner />
      ) : (
        <Context.Provider value={groups}>{children}</Context.Provider>
      )}
    </>
  );
};
