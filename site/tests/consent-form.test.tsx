import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ConsentForm } from "../src/client/components/ConsentForm";

describe("ConsentForm", () => {
  it("requires the consent checkbox before submitting", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <ConsentForm sourcePath="/" />
      </MemoryRouter>,
    );

    await userEvent.type(screen.getByLabelText(/phone number/i), "4155550123");
    await userEvent.click(screen.getByRole("button", { name: /join the wire/i }));

    expect(await screen.findByText(/please check the consent box before joining the wire/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits a valid opt-in and surfaces the returned confirmation text", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        optInConfirmationMessage:
          "Roscoe: you’re subscribed to account notifications, verification codes, and work alerts. Reply STOP to opt out, HELP for help. Msg & data rates may apply.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <ConsentForm sourcePath="/sms-consent" />
      </MemoryRouter>,
    );

    await userEvent.type(screen.getByLabelText(/phone number/i), "(415) 555-0123");
    await userEvent.type(screen.getByLabelText(/email/i), "hello@roscoe.sh");
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /join the wire/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/consent",
      expect.objectContaining({
        method: "POST",
      }),
    );

    expect(await screen.findByText(/you’re subscribed to account notifications/i)).toBeInTheDocument();
  });
});
