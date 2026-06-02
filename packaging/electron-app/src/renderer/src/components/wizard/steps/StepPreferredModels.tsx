import React from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export const StepPreferredModels: React.FC = () => {
  const categories = [
    { id: 'general', label: 'General Assistant', icon: '🤖' },
    { id: 'creative', label: 'Creative Writing', icon: '✍️' },
    { id: 'coding', label: 'Coding & Logic', icon: '💻' },
    { id: 'fast', label: 'Fast / Real-time', icon: '⚡' },
    { id: 'intel', label: 'High Intelligence', icon: '🧠' },
  ];

  const models = [
    { value: 'llama3-8b', label: 'Llama 3.1 8B' },
    { value: 'mistral-nemo', label: 'Mistral Nemo 12B' },
    { value: 'phi-3.5', label: 'Phi-3.5 Mini' },
    { value: 'gpt4', label: 'GPT-4o (Cloud)' },
    { value: 'claude-3-5', label: 'Claude 3.5 Sonnet (Cloud)' },
  ];

  return (
    <div className="space-y-6 py-4">
      <p className="text-sm text-muted-foreground">
        Set your preferred models for specific task types. Omnecor will automatically route requests based on these preferences.
      </p>

      <div className="space-y-4">
        {categories.map((cat) => (
          <div key={cat.id} className="p-4 border rounded-lg space-y-3 bg-muted/20">
            <div className="flex items-center gap-2">
              <span className="text-lg">{cat.icon}</span>
              <Label className="text-sm font-bold uppercase tracking-wider">{cat.label}</Label>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <span className="text-[10px] uppercase font-bold text-muted-foreground ml-1">Primary Model</span>
                <Select defaultValue={models[0].value}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Select primary" />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map(m => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <span className="text-[10px] uppercase font-bold text-muted-foreground ml-1">Fallback</span>
                <Select defaultValue="none">
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Select fallback" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {models.map(m => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
