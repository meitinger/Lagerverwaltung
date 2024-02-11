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

import JsBarcode from "jsbarcode";
import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button, Dropdown, DropdownButton, Spinner } from "react-bootstrap";
import { ButtonVariant } from "react-bootstrap/esm/types";
import { useAuth } from "./auth";
import "./common.css";
import { Database, SyncState, useSyncState } from "./db";
import { DialogContext } from "./dialog";
import { OperationInProgressError } from "./errors";
import {
  Language,
  strings as allStrings,
  languages,
  useStrings,
} from "./strings";

export const useProgress = <T, Args extends any[]>(
  callback: (...args: Args) => Promise<T>
): [boolean, (...args: Args) => Promise<T>] => {
  const [active, setActive] = useState(false);
  const operation = useCallback(
    async (...args: Args): Promise<T> => {
      if (active) {
        throw new OperationInProgressError();
      }
      setActive(true);
      try {
        return await callback(...args);
      } finally {
        setActive(false);
      }
    },
    [active, callback]
  );
  return [active, operation];
};

export const Barcode: React.FC<
  React.PropsWithChildren<{ name: string; ean: string }>
> = ({ name, ean, children }) => {
  const [valid, setValid] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (svgRef.current === null) {
      return;
    }
    setValid(true);
    try {
      JsBarcode(svgRef.current, ean, {
        format: "EAN13",
        valid: setValid,
      });
    } catch {
      setValid(false);
    }
  }, [ean]);
  const click = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const href = window.URL.createObjectURL(
        new Blob([e.currentTarget.outerHTML])
      );
      const element = document.createElement("a");
      element.download = `${name}.svg`;
      element.href = href;
      element.click();
      element.remove();
    },
    [name]
  );

  return (
    <>
      <svg
        className="barcode"
        ref={svgRef}
        style={{ display: valid ? "unset" : "none" }}
        onClick={click}
      />
      {!valid && children}
    </>
  );
};

export const CenteredSpinner: React.FC = () => (
  <div className="center">
    <Spinner />
  </div>
);

export const DatabaseButton: React.FC = () => {
  const strings = useStrings();
  const { isAdmin } = useAuth();
  const syncState = useSyncState();
  const buttonVariant = (() => {
    switch (syncState) {
      case SyncState.OFFLINE:
      case SyncState.CONNECTING:
        return "outline-warning";
      case SyncState.ONLINE:
      case SyncState.SYNCING:
        return "outline-success";
      case SyncState.ERROR:
      case SyncState.ERROR_WILL_RETRY:
        return "outline-danger";
    }
  })();
  const syncUpstream = useCallback(
    () =>
      Database.syncUpstream().then((changes) =>
        window.alert(strings.message.syncUpstreamResult(changes))
      ),
    [strings]
  );
  const syncDownstream = useCallback(
    () =>
      Database.syncDownstream().then((changes) =>
        window.alert(strings.message.syncDownstreamResult(changes))
      ),
    [strings]
  );
  const [syncingUpstream, syncUpstreamClick] = useProgress(syncUpstream);
  const [syncingDownstream, syncDownstreamClick] = useProgress(syncDownstream);
  const [connecting, connectClick] = useProgress(Database.connect);
  const [disconnecting, disconnectClick] = useProgress(Database.disconnect);
  const [resetting, resetClick] = useProgress(Database.reset);
  const active =
    syncingUpstream ||
    syncingDownstream ||
    connecting ||
    disconnecting ||
    resetting ||
    syncState === SyncState.CONNECTING ||
    syncState === SyncState.SYNCING;

  return (
    <DropdownButton
      title={
        <ProgressSpan active={active}>
          {strings.label.database(syncState)}
        </ProgressSpan>
      }
      variant={buttonVariant}
    >
      {isAdmin && (
        <Dropdown.Item disabled={syncingUpstream} onClick={syncUpstreamClick}>
          <ProgressSpan active={syncingUpstream}>
            {strings.button.syncUpstreamDatabase}
          </ProgressSpan>
        </Dropdown.Item>
      )}
      <Dropdown.Item
        disabled={
          syncingDownstream ||
          syncState === SyncState.CONNECTING ||
          syncState === SyncState.SYNCING
        }
        onClick={syncDownstreamClick}
      >
        <ProgressSpan
          active={syncingDownstream || syncState === SyncState.SYNCING}
        >
          {strings.button.syncDownstreamDatabase}
        </ProgressSpan>
      </Dropdown.Item>
      <Dropdown.Divider />
      <Dropdown.Item
        disabled={
          connecting ||
          syncState === SyncState.CONNECTING ||
          syncState === SyncState.ONLINE ||
          syncState === SyncState.SYNCING
        }
        onClick={connectClick}
      >
        <ProgressSpan active={connecting || syncState === SyncState.CONNECTING}>
          {strings.button.connectDatabase}
        </ProgressSpan>
      </Dropdown.Item>
      <Dropdown.Item
        disabled={
          disconnecting ||
          syncState === SyncState.OFFLINE ||
          syncState === SyncState.ERROR
        }
        onClick={disconnectClick}
      >
        <ProgressSpan active={disconnecting}>
          {strings.button.disconnectDatabase}
        </ProgressSpan>
      </Dropdown.Item>
      <Dropdown.Divider />
      <Dropdown.Item disabled={resetting} onClick={resetClick}>
        <ProgressSpan active={resetting}>
          {strings.button.resetDatabase}
        </ProgressSpan>
      </Dropdown.Item>
    </DropdownButton>
  );
};

export const DialogButton: React.FC<
  React.PropsWithChildren<{
    variant?: ButtonVariant;
    open: React.ReactNode;
  }>
> = ({ variant, open, children }) => {
  const setDialog = useContext(DialogContext);
  const click = useCallback(() => setDialog(open), [setDialog, open]);

  return (
    <Button variant={variant} onClick={click} className="text-nowrap">
      {children}
    </Button>
  );
};

export const InlineSpinner: React.FC = () => (
  <Spinner as="span" animation="grow" size="sm" />
);

export const LanguageButton: React.FC = () => {
  const strings = useStrings();

  return (
    <DropdownButton title={`${strings.button.language}`} variant="outline-dark">
      {languages.map((language) => (
        <LanguageItem key={language} language={language} />
      ))}
    </DropdownButton>
  );
};

const LanguageItem: React.FC<{ language: Language }> = ({ language }) => {
  const strings = useStrings();
  const click = useCallback(
    () => strings.setLanguage(language),
    [strings, language]
  );

  return (
    <Dropdown.Item active={strings.language === language} onClick={click}>
      {allStrings[language].label.language}
    </Dropdown.Item>
  );
};

export const ProgressSpan: React.FC<
  React.PropsWithChildren<{
    active: boolean;
  }>
> = ({ active, children }) => (
  <span className="text-nowrap">
    <Spinner
      className="mx-1"
      as="span"
      animation="grow"
      size="sm"
      hidden={!active}
    />
    {children}
  </span>
);

export const SpinnerRow: React.FC<{ colSpan?: number }> = ({ colSpan }) => (
  <tr>
    <td colSpan={colSpan} className="text-center">
      <Spinner />
    </td>
  </tr>
);
