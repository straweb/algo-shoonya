"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ListOrdered } from "lucide-react";
import { usePoll } from "@/lib/use-poll";
import { OrderRow, clockTime } from "@/lib/client-types";
import { cn } from "@/lib/utils";
import { strategyLabel } from "@/components/deployments";

const FILTERS = ["ALL", "PAPER", "LIVE", "REJECTED"] as const;

export function OrderLog() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [data] = usePoll<{ orders: OrderRow[] }>(`/api/orders?take=300`, 4000);

  const orders = (data?.orders ?? []).filter((o) =>
    filter === "ALL" ? true : filter === "REJECTED" ? o.status === "REJECTED" : o.mode === filter,
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Order Log</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every entry and exit fired by the engine — paper and live.</p>
        </div>
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium",
                filter === f ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground hover:bg-accent/70",
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time (IST)</TableHead>
                <TableHead>Deployment</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead>Side</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-14 text-center">
                    <ListOrdered className="mx-auto mb-2 h-7 w-7 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">No orders yet — they appear once deployments enter the market.</p>
                  </TableCell>
                </TableRow>
              )}
              {orders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="whitespace-nowrap tabular-nums text-xs">{clockTime(o.createdAt)}</TableCell>
                  <TableCell className="text-xs">
                    <div className="font-medium">{o.deployment?.name ?? "—"}</div>
                    <div className="text-muted-foreground">{o.deployment ? strategyLabel(o.deployment.strategyType) : ""}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{o.tsym}</TableCell>
                  <TableCell>
                    <span className={cn("text-xs font-semibold", o.side === "B" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                      {o.side === "B" ? "BUY" : "SELL"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{o.qty}</TableCell>
                  <TableCell className="text-right tabular-nums">₹{o.price.toFixed(2)}</TableCell>
                  <TableCell><Badge variant="outline" className={cn("text-[10px]", o.mode === "LIVE" && "border-rose-300 text-rose-600")}>{o.mode}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={o.status === "FILLED" ? "secondary" : "destructive"} className="text-[10px]">{o.status}</Badge>
                  </TableCell>
                  <TableCell className="hidden max-w-56 truncate text-xs text-muted-foreground lg:table-cell">{o.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
