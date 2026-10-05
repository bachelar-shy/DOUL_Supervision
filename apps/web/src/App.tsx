import { AppShell } from "./app/AppShell";
import { createSupervisionClient } from "./data/supervision-client";
import "./App.css";

const client = createSupervisionClient();

export default function App() {
  return <AppShell client={client} />;
}
