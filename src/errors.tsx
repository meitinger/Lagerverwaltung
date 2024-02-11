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

import React, { useCallback, useEffect, useState } from "react";
import { Alert, Button, Modal } from "react-bootstrap";
import { ErrorBoundary } from "react-error-boundary";
import { LanguageButton } from "./common";
import { useStrings } from "./strings";

const reloadApp = () => window.location.reload();

export const ErrorContext: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const strings = useStrings();
  const [lastError, setLastError] = useState<Error | undefined>();
  useEffect(() => {
    const error = (event: ErrorEvent) => {
      window.alert(strings.formatError(event.error));
    };
    const unhandledRejection = (event: PromiseRejectionEvent) => {
      window.alert(strings.formatError(event.reason));
    };

    window.addEventListener("error", error);
    window.addEventListener("unhandledrejection", unhandledRejection);

    return () => {
      window.removeEventListener("error", error);
      window.removeEventListener("unhandledrejection", unhandledRejection);
    };
  }, [strings]);
  const errorRenderer = useCallback(
    (renderError: any) => {
      const error =
        lastError ?? (renderError instanceof Error ? renderError : undefined);
      return (
        <Modal
          show={true}
          backdrop="static"
          keyboard={false}
          size="lg"
          centered
        >
          <Modal.Header>
            <Modal.Title>{strings.title.main}</Modal.Title>
            <LanguageButton />
          </Modal.Header>
          <Modal.Body>
            <Alert variant="danger">
              <Alert.Heading>{strings.label.appError}</Alert.Heading>
              <p>{strings.formatError(error ?? renderError)}</p>
              {error?.stack !== undefined && (
                <>
                  <hr />
                  <p className="mb-0">
                    {strings.label.stackTrace}
                    <br />
                    {error.stack.split("\n").map((line) => (
                      <>
                        <span className="font-monospace text-nowrap">
                          {line}
                        </span>
                        <br />
                      </>
                    ))}
                  </p>
                </>
              )}
            </Alert>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="primary" onClick={reloadApp}>
              {strings.button.reloadApp}
            </Button>
          </Modal.Footer>
        </Modal>
      );
    },
    [lastError, strings]
  );

  return (
    <ErrorBoundary onError={setLastError} fallbackRender={errorRenderer}>
      {children}
    </ErrorBoundary>
  );
};

export class FieldNotInFormDataError extends Error {
  public constructor(public readonly name: string) {
    super();
  }
}

export class InvalidResultError extends Error {
  public constructor(public readonly result: any) {
    super();
  }
}

export class InvalidTypeError extends TypeError {
  private static getType(value: any): string {
    switch (value) {
      case undefined:
        return "undefined";
      case null:
        return "null";
      default:
        return Array.isArray(value) ? "array" : typeof value;
    }
  }

  public readonly type: string;

  public constructor(
    public readonly name: string,
    public readonly value: any,
    public readonly expectedType:
      | "array"
      | "boolean"
      | "number"
      | "object"
      | "string"
  ) {
    super();
    this.type = InvalidTypeError.getType(value);
  }
}

export class LocalDatabaseChangesError extends Error {
  public constructor() {
    super();
  }
}

export class MissingConfigurationError extends Error {
  public constructor(public readonly option?: string) {
    super();
  }
}

export class MissingContextError extends Error {
  public constructor(public readonly name: string) {
    super();
  }
}

export class OperationInProgressError extends Error {
  public constructor() {
    super();
  }
}

export class SyncUrlMismatchError extends Error {
  public constructor(
    public readonly url: string,
    public readonly expectedUrl: string
  ) {
    super();
  }
}
