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

import { Msal2Provider } from "@microsoft/mgt-msal2-provider";
import { ProviderState, Providers } from "@microsoft/mgt-react";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Button, Modal } from "react-bootstrap";
import { ProgressSpan, useProgress } from "./common";
import { Database } from "./db";
import { InvalidTypeError } from "./errors";
import { Globals } from "./globals";
import { useStrings } from "./strings";

const login = () => (Providers.globalProvider as Msal2Provider).login();

const Context = createContext<
  Readonly<{
    userId: string;
    isAdmin: boolean;
  }>
>(Object.freeze({ userId: "*", isAdmin: false }));

export const useAuth = () => useContext(Context);

export const AuthContext: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const strings = useStrings();
  const [signedIn, setSignedIn] = useState(false);
  const [userId, setUserId] = useState("*");
  const [isAdmin, setAdmin] = useState(false);
  const authContext = useMemo(
    () =>
      Object.freeze({
        userId,
        isAdmin,
      }),
    [userId, isAdmin]
  );
  const [loggingIn, loginClick] = useProgress(login);
  useEffect(() => {
    const updateUser = () => {
      const provider = Providers.globalProvider;
      if (
        provider.state === ProviderState.SignedIn &&
        provider.getActiveAccount
      ) {
        const roles = (Providers.globalProvider as any).getAccount()
          .idTokenClaims.roles;
        if (!Array.isArray(roles)) {
          throw new InvalidTypeError("roles", roles, "array");
        }
        setSignedIn(true);
        setUserId(provider.getActiveAccount().id.split(".")[0].toLowerCase());
        setAdmin(roles.includes("Manage"));
        Database.syncDownstream();
      } else {
        Database.disconnect();
        setSignedIn(false);
        setUserId("*");
        setAdmin(false);
      }
    };

    Providers.globalProvider ??= new Msal2Provider({
      clientId: Globals.clientId,
      authority: `https://login.microsoftonline.com/${Globals.tenantId}`,
      scopes: ["user.read"],
    });

    Providers.onProviderUpdated(updateUser);
    updateUser();
    if (Providers.globalProvider instanceof Msal2Provider) {
      Providers.globalProvider.trySilentSignIn();
    }

    return () => {
      Providers.removeProviderUpdatedListener(updateUser);
    };
  }, []);

  return (
    <>
      <Modal show={!signedIn} backdrop="static" keyboard={false} centered>
        <Modal.Header>
          <Modal.Title>{strings.title.main}</Modal.Title>
        </Modal.Header>
        <Modal.Body>{strings.greeting}</Modal.Body>
        <Modal.Footer>
          <Button variant="primary" disabled={loggingIn} onClick={loginClick}>
            <ProgressSpan active={loggingIn}>
              {strings.button.login}
            </ProgressSpan>
          </Button>
        </Modal.Footer>
      </Modal>
      {signedIn && (
        <Context.Provider value={authContext}>{children}</Context.Provider>
      )}
    </>
  );
};
