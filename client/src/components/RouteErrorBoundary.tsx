import React from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle, RotateCcw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface Props {
  error: Error;
  resetErrorBoundary: () => void;
}

export function RouteErrorBoundary({ error, resetErrorBoundary }: Props) {
  return (
    <div className="flex h-[50vh] w-full items-center justify-center p-6">
      <Alert variant="destructive" className="max-w-md">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Panel Error</AlertTitle>
        <AlertDescription className="mt-2 space-y-4">
          <p className="text-sm opacity-90">
            An unexpected error occurred while rendering this component.
          </p>
          <pre className="bg-destructive-foreground/10 p-2 rounded text-xs overflow-auto max-h-32">
            {error.message}
          </pre>
          <Button
            variant="outline"
            size="sm"
            onClick={resetErrorBoundary}
            className="w-full flex items-center gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            Reload Panel
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}

export default RouteErrorBoundary;
