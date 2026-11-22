import { Footer, Header } from "./components/Chrome.js";
import { HowItWorks } from "./pages/HowItWorks.js";
import { NotFound } from "./pages/NotFound.js";
import { Registry } from "./pages/Registry.js";
import { routes, usePath } from "./router.js";

function Page({ path }: { path: string }) {
  switch (path.replace(/\/+$/, "") || "/") {
    case routes.registry:
      return <Registry />;
    case routes.how:
      return <HowItWorks />;
    default:
      return <NotFound />;
  }
}

export function App() {
  const path = usePath();
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
