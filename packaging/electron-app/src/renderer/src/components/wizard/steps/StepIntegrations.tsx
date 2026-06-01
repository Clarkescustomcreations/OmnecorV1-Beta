import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';

export const StepIntegrations: React.FC = () => {
  const integrations = [
    { name: 'OpenAI', icon: '🤖', placeholder: 'sk-...' },
    { name: 'Anthropic', icon: '🧠', placeholder: 'sk-ant-...' },
    { name: 'Google Gemini', icon: '✨', placeholder: 'AIza...' },
    { name: 'Mistral', icon: '🌪️', placeholder: '...' },
    { name: 'ElevenLabs', icon: '🗣️', placeholder: '...' },
  ];

  return (
    <div className="space-y-6 py-4">
      <p className="text-sm text-muted-foreground">
        Connect to external services while keeping your sensitive data local. Keys are stored encrypted.
      </p>
      <div className="grid grid-cols-2 gap-4">
        {integrations.map((item) => (
          <Card key={item.name}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span>{item.icon}</span>
                <Label className="font-semibold">{item.name}</Label>
              </div>
              <Input type="password" placeholder={item.placeholder} />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

