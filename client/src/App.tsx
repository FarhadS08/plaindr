import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import History from "./pages/History";
import Profile from "./pages/Profile";
import SignIn from "./pages/SignIn";
import SignUp from "./pages/SignUp";
import Dashboard from "./pages/Dashboard";
import Chat from "./pages/Chat";
import Policies from "./pages/Policies";
import PolicyDetail from "./pages/PolicyDetail";
import DiffDetail from "./pages/DiffDetail";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/sign-in"} component={SignIn} />
      <Route path={"/sign-up"} component={SignUp} />
      <Route path={"/history"} component={History} />
      <Route path={"/profile"} component={Profile} />
      <Route path={"/dashboard"} component={Dashboard} />
      <Route path={"/dashboard/chat"} component={Chat} />
      <Route path={"/dashboard/policies"} component={Policies} />
      <Route path={"/dashboard/policies/:sourceUrlEncoded"} component={PolicyDetail} />
      <Route path={"/dashboard/diffs/:id"} component={DiffDetail} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
