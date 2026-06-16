import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { CriticalAction } from "@shared/hitl";

interface CriticalActionChecklistProps {
  action: CriticalAction | null;
  onApprove: (id: string) => void;
  /** Deny the action, optionally telling the agent why so it can adjust. */
  onReject: (id: string, reason?: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CriticalActionChecklist({
  action,
  onApprove,
  onReject,
  open,
  onOpenChange,
}: CriticalActionChecklistProps) {
  const [reason, setReason] = useState("");

  if (!action) return null;

  const handleReject = () => {
    onReject(action.id, reason.trim() || undefined);
    setReason("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-destructive">
            Critical Action Required
          </DialogTitle>
          <DialogDescription>
            The agent is requesting to perform a critical action that requires
            your manual review.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div className="p-4 bg-muted rounded-md font-mono text-sm">
            <p>
              <strong>Tool:</strong> {action.toolName}
            </p>
            <p>
              <strong>Arguments:</strong> {JSON.stringify(action.args, null, 2)}
            </p>
          </div>
          <p className="text-sm">
            Please verify the integrity of this action before proceeding.
          </p>
          <div className="space-y-1">
            <label
              htmlFor="hitl-deny-reason"
              className="text-xs text-muted-foreground"
            >
              Reason for denial (optional — shared with the agent so it can
              adjust)
            </label>
            <Textarea
              id="hitl-deny-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Use the staging bucket, not production."
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleReject}>
            Deny
          </Button>
          <Button variant="default" onClick={() => onApprove(action.id)}>
            Approve Critical Action
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
