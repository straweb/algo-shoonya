"use client";

import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, LogOut, ArrowUpRight, ArrowDownRight, Scale } from "lucide-react";
import { STRATEGY_LIST } from "@/lib/strategies";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const RISK_STYLE: Record<string, string> = {
  HIGH: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  MEDIUM: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  LOW: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
};

const CAT_ICON = {
  "OPTION SELLING": ArrowUpRight,
  "OPTION BUYING": ArrowDownRight,
} as const;

export function Strategies() {
  const openWizard = useAppStore((s) => s.openWizard);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Strategy Marketplace</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ready-to-deploy index option strategies — pick one, set capital &amp; risk, and let the engine trade it on Shoonya.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {STRATEGY_LIST.map((s) => {
          const Icon = CAT_ICON[s.category];
          return (
            <Card key={s.id} className="flex flex-col transition-shadow hover:shadow-md">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-lg",
                      s.category === "OPTION SELLING"
                        ? "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300"
                        : "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
                    )}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold leading-tight">{s.name}</h3>
                      <p className="text-xs text-muted-foreground">{s.tagline}</p>
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge variant="secondary" className="text-[10px]">{s.category}</Badge>
                  <Badge className={cn("text-[10px]", RISK_STYLE[s.risk])}>{s.risk} RISK</Badge>
                  {s.calendar && <Badge variant="outline" className="text-[10px]">2 EXPIRIES</Badge>}
                </div>
              </CardHeader>
              <CardContent className="flex-1 space-y-3 pb-3">
                <p className="text-sm leading-relaxed text-muted-foreground">{s.description}</p>
                <p className="rounded-md bg-zinc-50 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                  {s.legs}
                </p>
              </CardContent>
              <CardFooter className="flex items-center justify-between border-t pt-3">
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {s.entryTime} → {s.squareOffTime}</span>
                  {s.needsDirection && <span className="inline-flex items-center gap-1"><Scale className="h-3.5 w-3.5" /> {s.direction}</span>}
                </div>
                <Button size="sm" onClick={() => openWizard(s.id)}>
                  Configure &amp; Deploy
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
