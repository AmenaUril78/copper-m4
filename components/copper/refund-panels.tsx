"use client";

// Copper Support and the Refund Console, as two slide-out panels on the home
// page (the site stays a single page). A launcher at the bottom left opens the
// support chat; /#support and /#refund-console open the panels too, and the
// support panel links to the console for staff.
import { LifeBuoyIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { RefundConsole } from "@/components/copper/refund-console";
import { SupportChat, type SupportTurn } from "@/components/copper/support-chat";
import { SetupRequired } from "@/components/setup-required";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  loadRefundConsole,
  type ConsoleData,
} from "@/lib/copper/refund-actions";

function ConsoleBody({ supabaseConfigured }: { supabaseConfigured: boolean }) {
  const [data, setData] = useState<ConsoleData | "loading">("loading");

  // After a decision or a new limit, read everything again.
  const reload = useCallback(async () => {
    setData(await loadRefundConsole());
  }, []);

  // The panel's content only exists while it is open, so this reads fresh
  // refunds every time it opens.
  useEffect(() => {
    if (!supabaseConfigured) return;
    let cancelled = false;
    void loadRefundConsole().then((result) => {
      if (!cancelled) setData(result);
    });
    return () => {
      cancelled = true;
    };
  }, [supabaseConfigured]);

  if (!supabaseConfigured) {
    return (
      <p className="text-sm">
        Set up Supabase to use the console: add the Supabase variables to
        .env.local, run the refund migration and seed, then restart the dev
        server.
      </p>
    );
  }
  if (data === "loading") {
    return <p className="text-muted-foreground text-sm">Loading refunds…</p>;
  }
  if (data.status === "unavailable") {
    return (
      <p className="text-sm">
        Refunds can&apos;t be read right now. Check that the refund migration
        has been run in Supabase, then reopen this panel.
      </p>
    );
  }
  return (
    <RefundConsole
      refunds={data.refunds}
      limitCents={data.limitCents}
      onChanged={() => void reload()}
    />
  );
}

export function RefundPanels({
  aiConfigured,
  supabaseConfigured,
}: {
  aiConfigured: boolean;
  supabaseConfigured: boolean;
}) {
  const [supportOpen, setSupportOpen] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  // The conversation lives here, not in the chat, because a closed panel
  // unmounts its content. This way closing the panel (or opening the console)
  // doesn't wipe the chat.
  const [turns, setTurns] = useState<SupportTurn[]>([]);

  // Loading the site at /#support or /#refund-console opens that panel. A
  // click on a link to the same hash is heard too, as it fires no hashchange.
  useEffect(() => {
    const openFromHash = () => {
      if (window.location.hash === "#support") setSupportOpen(true);
      if (window.location.hash === "#refund-console") setConsoleOpen(true);
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element;
      if (target.closest('a[href="#support"]')) setSupportOpen(true);
      if (target.closest('a[href="#refund-console"]')) setConsoleOpen(true);
    };
    const first = window.setTimeout(openFromHash, 0);
    window.addEventListener("hashchange", openFromHash);
    document.addEventListener("click", onClick);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener("hashchange", openFromHash);
      document.removeEventListener("click", onClick);
    };
  }, []);

  return (
    <>
      <Button
        data-testid="support-launcher"
        variant="secondary"
        onClick={() => setSupportOpen(true)}
        className="fixed bottom-4 left-4 z-40 h-12 rounded-full border px-5 shadow-lg"
      >
        <LifeBuoyIcon />
        Copper Support
      </Button>

      <Sheet open={supportOpen} onOpenChange={setSupportOpen}>
        <SheetContent
          side="left"
          data-testid="support-panel"
          showCloseButton={false}
          className="w-full gap-0 p-0 data-[side=left]:w-full data-[side=left]:sm:max-w-lg"
        >
          <SheetTitle className="sr-only">Copper Support</SheetTitle>
          <SheetDescription className="sr-only">
            Ask Copper a question, or ask for a refund.
          </SheetDescription>
          {aiConfigured ? (
            <>
              {!supabaseConfigured && (
                <p className="bg-chart-4/15 border-b p-3 text-sm">
                  Refunds aren&apos;t set up yet: they need Supabase. Copper can
                  still answer shopping questions.
                </p>
              )}
              <SupportChat turns={turns} setTurns={setTurns} />
            </>
          ) : (
            <div className="bg-secondary flex-1 overflow-y-auto p-4">
              <SetupRequired service="ai" />
            </div>
          )}
          <div className="bg-card flex items-center justify-between gap-2 border-t p-2 text-xs">
            <Button
              variant="link"
              size="sm"
              className="h-auto p-1 text-xs"
              onClick={() => {
                setSupportOpen(false);
                setConsoleOpen(true);
              }}
            >
              Staff: open the Refund Console
            </Button>
            <SheetClose asChild>
              <Button variant="ghost" size="sm">
                Close
              </Button>
            </SheetClose>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={consoleOpen} onOpenChange={setConsoleOpen}>
        <SheetContent
          data-testid="refund-console"
          showCloseButton={false}
          className="w-full gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl"
        >
          <div className="bg-chart-5 text-secondary flex items-start justify-between gap-3 p-4">
            <div>
              <SheetTitle className="text-secondary">Refund Console</SheetTitle>
              <SheetDescription className="text-secondary/70">
                For staff: decide refunds, set the limit, read the log.
              </SheetDescription>
            </div>
            <SheetClose asChild>
              <Button
                variant="ghost"
                size="sm"
                className="hover:bg-secondary/10 hover:text-secondary text-secondary"
              >
                Close
              </Button>
            </SheetClose>
          </div>
          <div className="bg-secondary flex-1 space-y-4 overflow-y-auto p-4">
            <p
              role="note"
              className="border-chart-4 bg-chart-4/15 rounded-md border p-3 text-sm"
            >
              <strong>Class demo only.</strong> There is no login, so anyone who
              can open this panel could approve refunds. Real use needs
              authentication. All orders and customers are fictional.
            </p>
            <ConsoleBody supabaseConfigured={supabaseConfigured} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
