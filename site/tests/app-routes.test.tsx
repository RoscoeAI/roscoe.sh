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
  it("renders the frontier hero and consent entrypoint on the home page", () => {
    renderRoute("/");

    expect(
      screen.getByRole("heading", {
        name: /autopilot for claude & codex, styled like a wagon-train telegraph office/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /join the wire/i })).toBeInTheDocument();
    expect(screen.getByText(/transactional sms only\. no marketing\./i)).toBeInTheDocument();
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
