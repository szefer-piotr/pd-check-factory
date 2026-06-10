import { BrowserRouter } from "react-router-dom";
import { AppRouter } from "./router";

export function AppRouterTree(): JSX.Element {
  return <AppRouter />;
}

export default function App(): JSX.Element {
  return (
    <BrowserRouter>
      <AppRouter />
    </BrowserRouter>
  );
}
