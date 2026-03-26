import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../src/client/app";

function renderRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("site routes", () => {
  it("renders the rewritten home hero and compliance entrypoint on the home page", () => {
    renderRoute("/");

    expect(
      screen.getByRole("heading", {
        name: /never again\./i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Roscoe keeps Codex and Claude CLI prompts from dying, starts with the onboarding interview, and keeps continuous development moving with real local agents\./i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /get started/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /sms for real alerts/i })).toBeInTheDocument();
    expect(screen.getByText(/transactional sms only\. no marketing\./i)).toBeInTheDocument();
  });

  it("renders the docs page with install and onboarding guidance", () => {
    renderRoute("/docs");

    expect(screen.getByRole("heading", { name: /install roscoe\. train it\. run the lane stack/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /^install$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /onboard/i })).toBeInTheDocument();
    expect(screen.getByText(/roscoe onboard \/path\/to\/project/i)).toBeInTheDocument();
  });

  it("renders the public sms consent proof page", () => {
    renderRoute("/sms-consent");

    expect(
      screen.getByRole("heading", {
        name: /public web opt-in for roscoe transactional messaging/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/reply stop to opt out/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/carriers are not liable/i).length).toBeGreaterThan(0);
  });

  it("renders privacy and terms pages with compliance copy", () => {
    const { unmount } = renderRoute("/privacy");
    expect(screen.getByRole("heading", { name: /roscoe keeps the ledger narrow/i })).toBeInTheDocument();
    expect(screen.getByText(/does not sell, share, rent, transfer, or exchange mobile opt-in data/i)).toBeInTheDocument();

    unmount();
    renderRoute("/terms");

    expect(screen.getByRole("heading", { name: /the wire only carries operational messages/i })).toBeInTheDocument();
    expect(screen.getAllByText(/message frequency varies/i).length).toBeGreaterThan(0);
  });
});
