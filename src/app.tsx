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

import { Login } from "@microsoft/mgt-react";
import React, { createContext, useCallback, useContext, useState } from "react";
import { Container, Nav, Navbar, Tab } from "react-bootstrap";
import { DatabaseButton, LanguageButton } from "./common";
import { DialogContext } from "./dialog";
import { MissingContextError } from "./errors";
import { GroupsContext } from "./groups";
import { Permissions } from "./permission";
import { Products } from "./product";
import { Storages } from "./storage";
import { useStrings } from "./strings";

type TabKey = "products" | "storages" | "permissions";

const TabsContext = createContext<
  [TabKey | undefined, React.Dispatch<React.SetStateAction<TabKey>>]
>([
  undefined,
  () => {
    throw new MissingContextError("Tabs");
  },
]);

export const useTabs = () => useContext(TabsContext);

export const App: React.FC = () => {
  const strings = useStrings();
  const [dialog, setDialog] = useState<React.ReactNode | undefined>();
  const [tab, setTab] = useState<TabKey>("products");

  return (
    <TabsContext.Provider value={[tab, setTab]}>
      <DialogContext.Provider value={setDialog}>
        <Navbar collapseOnSelect expand="lg" className="bg-body-tertiary">
          <Container>
            <Navbar.Brand>{strings.title.main}</Navbar.Brand>
            <Navbar.Toggle aria-controls="responsive-navbar-nav" />
            <Navbar.Collapse id="responsive-navbar-nav">
              <Nav variant="pills" className="mx-1">
                <TabLink tab="products" />
                <TabLink tab="storages" />
                <TabLink tab="permissions" />
              </Nav>
              <Nav className="mx-1">
                <DatabaseButton />
              </Nav>
              <Nav className="mx-1">
                <LanguageButton />
              </Nav>
              <Nav className="mx-1">
                <Login />
              </Nav>
            </Navbar.Collapse>
          </Container>
        </Navbar>
        <GroupsContext>
          {dialog}
          <Container className="mt-3">
            <Tab.Container activeKey={tab}>
              <Tab.Content>
                <Tab.Pane eventKey="products">
                  <Products />
                </Tab.Pane>
                <Tab.Pane eventKey="storages">
                  <Storages />
                </Tab.Pane>
                <Tab.Pane eventKey="permissions">
                  <Permissions />
                </Tab.Pane>
              </Tab.Content>
            </Tab.Container>
          </Container>
        </GroupsContext>
      </DialogContext.Provider>
    </TabsContext.Provider>
  );
};

const TabLink: React.FC<{
  tab: TabKey;
}> = ({ tab }) => {
  const strings = useStrings();
  const [activeTab, setActiveTab] = useTabs();
  const click = useCallback(() => setActiveTab(tab), [setActiveTab, tab]);

  return (
    <Nav.Item>
      <Nav.Link active={tab === activeTab} onClick={click}>
        {strings.title[tab]}
      </Nav.Link>
    </Nav.Item>
  );
};
