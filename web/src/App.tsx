import { Footer, Header } from "./components/Chrome.js";
import { HowItWorks } from "./pages/HowItWorks.js";
import { NotFound } from "./pages/NotFound.js";
import { Registry } from "./pages/Registry.js";
import { Retirements } from "./pages/Retirements.js";
import { TryIt } from "./pages/TryIt.js";
import { Verify } from "./pages/Verify.js";
import { routes, usePath } from "./router.js";

function Page({ path }: { path: string }) {
  switch (path) {
    case routes.registry:
      return <Registry />;
    case routes.retirements:
      return <Retirements />;
    case routes.verify:
      return <Verify />;
    case routes.try:
      return <TryIt />;
    case routes.how:
      return <HowItWorks />;
    default:
      return <NotFound />;
  }
}

export function App() {
  const path = usePath().replace(/\/+$/, "") || "/";
  return (
    <>
      <Header path={path} />
      <main id="main" tabIndex={-1}>
        <Page path={path} />
      </main>
      <Footer />
    </>
  );
}
