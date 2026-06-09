/**
 * ComponentLibraryPanel Component
 *
 * Left sidebar panel showing:
 * - Categorized component list
 * - Search functionality
 * - Drag-and-drop support
 */

import React, { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  componentLibrary,
  getAllCategories,
  getComponentsByCategory,
  searchComponents,
} from '@/lib/componentLibrary';
import { Search } from 'lucide-react';

export interface ComponentLibraryPanelProps {
  onAddComponent: (componentId: string, position: { x: number; y: number }) => void;
  mode: 'schematic' | 'pcb';
}

export const ComponentLibraryPanel: React.FC<ComponentLibraryPanelProps> = ({
  onAddComponent,
  mode,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [draggedComponent, setDraggedComponent] = useState<string | null>(null);

  const categories = useMemo(() => getAllCategories(), []);

  const filteredComponents = useMemo(() => {
    if (!searchQuery) return componentLibrary;
    return searchComponents(searchQuery);
  }, [searchQuery]);

  const componentsByCategory = useMemo(() => {
    const result: Record<string, typeof componentLibrary> = {};
    categories.forEach((cat) => {
      result[cat] = filteredComponents.filter((comp) => comp.category === cat);
    });
    return result;
  }, [categories, filteredComponents]);

  const handleDragStart = (e: React.DragEvent, componentId: string) => {
    setDraggedComponent(componentId);
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('componentId', componentId);
  };

  const handleDragEnd = () => {
    setDraggedComponent(null);
  };

  return (
    <div className="w-64 border-r border-border bg-card flex flex-col shadow-sm">
      {/* Header */}
      <div className="p-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground mb-3">Component Library</h2>

        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search components..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div>

      {/* Components List */}
      <ScrollArea className="flex-1">
        <Tabs defaultValue={categories[0]} className="w-full">
          <TabsList className="w-full justify-start rounded-none border-b border-border bg-muted/50 p-0">
            {categories.map((category) => (
              <TabsTrigger
                key={category}
                value={category}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-accent text-xs"
              >
                {category.split(' ')[0]}
              </TabsTrigger>
            ))}
          </TabsList>

          {categories.map((category) => (
            <TabsContent key={category} value={category} className="p-2">
              <div className="space-y-2">
                {componentsByCategory[category]?.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    No components found
                  </p>
                ) : (
                  componentsByCategory[category]?.map((component) => (
                    <div
                      key={component.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, component.id)}
                      onDragEnd={handleDragEnd}
                      className={`
                        p-2 rounded border cursor-move transition-all
                        ${
                          draggedComponent === component.id
                            ? 'bg-accent/20 border-accent opacity-50'
                            : 'bg-muted/40 border-border hover:bg-accent/10 hover:border-accent/50'
                        }
                      `}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-8 h-8 bg-background border border-border rounded flex items-center justify-center text-xs text-muted-foreground flex-shrink-0">
                          <div
                            dangerouslySetInnerHTML={{
                              __html: component.symbolSvg,
                            }}
                            className="w-6 h-6"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-foreground truncate">
                            {component.name}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {component.description}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1">
                        {component.tags.slice(0, 2).map((tag) => (
                          <span
                            key={tag}
                            className="inline-block text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </ScrollArea>

      {/* Footer Info */}
      <div className="p-2 border-t border-border bg-muted/40 text-xs text-muted-foreground">
        <p>Drag components to canvas</p>
      </div>
    </div>
  );
};

export default ComponentLibraryPanel;
