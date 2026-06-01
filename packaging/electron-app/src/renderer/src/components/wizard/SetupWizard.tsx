import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { StepNetwork } from './steps/StepNetwork';
import { StepModels } from './steps/StepModels';
import { StepKnowledgeBase } from './steps/StepKnowledgeBase';
import { StepPreferences } from './steps/StepPreferences';
import { StepIntegrations } from './steps/StepIntegrations';
import type { SystemInfo } from '@/../../preload/index.d';

const STEPS = [
  { id: 'welcome',      title: 'Welcome',       description: 'Establishing secure local connectivity.' },
  { id: 'omsh',         title: 'Model Server',  description: 'Configuring your local model backend.' },
  { id: 'valet',        title: 'Local Valet',   description: 'Choosing your always-on assistant.' },
  { id: 'integrations', title: 'Integrations',  description: 'Connecting cloud services (optional).' },
  { id: 'brain',        title: 'Neural Map',    description: 'Building your personal knowledge base.' },
  { id: 'creative',     title: 'Creative Map',  description: 'Specialized memory for storytelling.' },
  { id: 'preferences',  title: 'Preferences',   description: 'Personalizing your AI experience.' },
  { id: 'finish',       title: 'Ready!',        description: 'Your workstation is configured.' },
];

export const SetupWizard: React.FC = () => {
  const [currentStep, setCurrentStep] = useState(0);
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  const progress = ((currentStep + 1) / STEPS.length) * 100;

  useEffect(() => {
    window.api.getSystemInfo()
      .then(setSysInfo)
      .catch((e) => console.error('Failed to fetch system info', e));
  }, []);

  const nextStep = () => {
    if (currentStep < STEPS.length - 1) setCurrentStep(currentStep + 1);
  };

  const prevStep = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  };

  const handleLaunch = () => {
    // Signal Electron main process to swap the wizard view for the full app
    window.api.setupComplete();
  };

  const renderStep = () => {
    switch (STEPS[currentStep].id) {
      case 'welcome':
        return <StepNetwork />;
      case 'omsh':
      case 'valet':
        return <StepModels step={STEPS[currentStep].id} sysInfo={sysInfo} />;
      case 'integrations':
        return <StepIntegrations />;
      case 'brain':
      case 'creative':
        return <StepKnowledgeBase type={STEPS[currentStep].id} />;
      case 'preferences':
        return <StepPreferences sysInfo={sysInfo} />;
      default:
        return (
          <div className="py-10 text-center space-y-4">
            <div className="text-5xl">🚀</div>
            <h2 className="text-2xl font-bold">You're all set!</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              Your sovereign AI workstation is configured and ready. Click{' '}
              <strong>Launch Workstation</strong> to begin.
            </p>
            {sysInfo?.isLegacy && (
              <p className="text-sm text-orange-400">
                Legacy mode active — lightweight models selected for your hardware.
              </p>
            )}
          </div>
        );
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <Card className="w-full max-w-4xl shadow-xl">
        <CardHeader>
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-muted-foreground">
              Step {currentStep + 1} of {STEPS.length}
            </span>
            <div className="flex gap-2 items-center">
              {sysInfo?.isLegacy && (
                <Badge className="bg-orange-500 hover:bg-orange-600 border-none text-white">
                  Legacy PC Mode
                </Badge>
              )}
              <span className="text-sm font-bold text-primary">
                {STEPS[currentStep].title}
              </span>
            </div>
          </div>
          <Progress value={progress} className="h-2" />
          <CardTitle className="mt-6 text-3xl font-extrabold tracking-tight">
            {STEPS[currentStep].title}
          </CardTitle>
          <CardDescription className="text-lg">
            {STEPS[currentStep].description}
          </CardDescription>
        </CardHeader>

        <CardContent className="min-h-[400px]">
          {renderStep()}
        </CardContent>

        <CardFooter className="flex justify-between border-t p-6">
          <Button
            variant="ghost"
            onClick={prevStep}
            disabled={currentStep === 0}
          >
            Back
          </Button>
          <Button
            onClick={currentStep === STEPS.length - 1 ? handleLaunch : nextStep}
            className={currentStep === STEPS.length - 1 ? 'bg-green-600 hover:bg-green-700' : ''}
          >
            {currentStep === STEPS.length - 1 ? 'Launch Workstation' : 'Next Step →'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
};
