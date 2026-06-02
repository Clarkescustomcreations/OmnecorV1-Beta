import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const StepIntegrations: React.FC = () => {
  const [activeTab, setActiveTab] = useState('llm');

  const categories = [
    { id: 'llm', label: 'Cloud LLMs' },
    { id: 'embed', label: 'Embedding' },
    { id: 'image', label: 'Image Gen' },
    { id: 'speech', label: 'Speech' },
    { id: 'search', label: 'Search' },
  ];

  const integrations: Record<string, any[]> = {
    llm: [
      { name: 'OpenAI', icon: '🤖', connected: true },
      { name: 'Anthropic', icon: '🧠', connected: false },
      { name: 'Google Gemini', icon: '✨', connected: false },
    ],
    embed: [
      { name: 'Cohere', icon: '🎯', connected: false },
      { name: 'Voyage AI', icon: '🚢', connected: false },
    ],
    image: [
      { name: 'Midjourney', icon: '🎨', connected: false },
      { name: 'DALL-E 3', icon: '🖼️', connected: true },
      { name: 'Stability AI', icon: '🌀', connected: false },
    ],
    speech: [
      { name: 'ElevenLabs', icon: '🗣️', connected: true },
      { name: 'Deepgram', icon: '🎙️', connected: false },
    ],
    search: [
      { name: 'Tavily', icon: '🔍', connected: false },
      { name: 'Perplexity', icon: '🌐', connected: false },
      { name: 'Brave Search', icon: '🦁', connected: false },
    ]
  };

  return (
    <div className="space-y-6 py-4">
      <div className="p-3 border rounded-lg bg-blue-500/5 border-blue-500/20 text-xs text-blue-600 dark:text-blue-400">
        ℹ️ All API keys are stored in your encrypted local vault. They never leave your machine except when making authenticated requests to the respective provider.
      </div>

      <div className="flex gap-1 border-b pb-px overflow-x-auto no-scrollbar">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveTab(cat.id)}
            className={`px-3 py-2 text-xs font-medium transition-colors border-b-2 whitespace-nowrap ${
              activeTab === cat.id 
                ? 'border-primary text-primary' 
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3">
        {integrations[activeTab].map((item) => (
          <Card key={item.name}>
            <CardContent className="p-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xl">{item.icon}</span>
                <div className="flex flex-col">
                  <Label className="font-semibold">{item.name}</Label>
                  {item.connected ? (
                    <Badge variant="secondary" className="w-fit text-[9px] h-3.5 px-1 bg-green-500/10 text-green-500 border-none">Connected</Badge>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">Not configured</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Input type="password" placeholder="API Key" className="h-8 text-xs w-40" />
                <Button size="sm" variant={item.connected ? "outline" : "default"} className="h-8 text-xs">
                  {item.connected ? 'Update' : 'Connect'}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};
