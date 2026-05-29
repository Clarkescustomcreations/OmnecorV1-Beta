import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { useOmnecorSocket } from '../hooks/useOmnecorSocket';

export function HITLAlertPanel({ projectId }: { projectId: string }) {
  const { loopDetected, clearFileEvents } = useOmnecorSocket({ listenForLoops: true, projectId });
  const [acknowledged, setAcknowledged] = useState(false);

  const handleAcknowledge = () => {
    clearFileEvents();
    setAcknowledged(true);
  };

  if (!loopDetected || acknowledged) return null;

  return (
    <Dialog open={true}>
      <DialogContent className="sm:max-w-md bg-destructive text-destructive-foreground z-[1000]">
        <DialogHeader>
          <DialogTitle>Agent Loop Detected</DialogTitle>
          <DialogDescription className="text-destructive-foreground/80">
            The agent has repeated the same action (ID: {loopDetected.agentId}) {loopDetected.count} times. 
            Manual review required before execution can resume.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-start">
          <Button variant="secondary" onClick={handleAcknowledge}>
            Acknowledge & Clear
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
