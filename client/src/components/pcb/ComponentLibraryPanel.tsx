/**
 * ComponentLibraryPanel Component
 *
 * Left sidebar showing categorised components.
 * Supports both click-to-add (places near canvas center) and
 * drag-and-drop (handled by the canvas onDrop).
 */

import React, { useState, useMemo } from 'react';
import DOMPurify from 'dompurify';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  componentLibrary,
  getAllCategories,
  searchComponents,
} from '@/lib/componentLibrary';
import { Search, X, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface ComponentLibraryPanelProps {
  onAddComponent: (componentId: string, position: { x: number; y: number }) => void;
  mode: 'schematic' | 'pcb';
  onClose?: () => void;
}

export const ComponentLibraryPanel: React.FC<ComponentLibraryPanelProps> = ({
  onAddComponent,
  onClose,
  mode: _mode,
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

  // Click-to-add: place at a slightly randomised canvas position so
  // multiple click-added components don't stack on top of each other.
  const handleClick = (componentId: string) => {
    const x = 200 + Math.random() * 160;
    const y = 160 + Math.random() * 160;
    onAddComponent(componentId, { x, y });
  };

  return (
    <div className="w-64 border-r border-border bg-card flex flex-col min-h-0 shadow-sm">
      {/* Header */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-foreground">Component Library</h2>
          {onClose && (
            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" onClick={onClose} title="Collapse Panel">
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mb-2">Click to add · Drag to position</p>

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
      <ScrollArea className="min-h-0 flex-1">
        {searchQuery ? (
          /* Flat search results — no category tabs */
          <div className="p-2 space-y-2">
            {filteredComponents.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No components found</p>
            ) : (
              filteredComponents.map((component) => (
                <ComponentCard
                  key={component.id}
                  component={component}
                  isDragging={draggedComponent === component.id}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onClick={handleClick}
                />
              ))
            )}
          </div>
        ) : (
          <Tabs defaultValue={categories[0]} className="w-full">
            <TabsList className="w-full justify-start rounded-none border-b border-border bg-muted/50 p-0 overflow-x-auto">
              {categories.map((category) => (
                <TabsTrigger
                  key={category}
                  value={category}
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary/30 text-[10px] shrink-0"
                >
                  {category.split(' ')[0]}
                </TabsTrigger>
              ))}
            </TabsList>

            {categories.map((category) => (
              <TabsContent key={category} value={category} className="p-2">
                <div className="space-y-2">
                  {componentsByCategory[category]?.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">No components found</p>
                  ) : (
                    componentsByCategory[category]?.map((component) => (
                      <ComponentCard
                        key={component.id}
                        component={component}
                        isDragging={draggedComponent === component.id}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                        onClick={handleClick}
                      />
                    ))
                  )}
                </div>
              </TabsContent>
            ))}
          </Tabs>
        )}
      </ScrollArea>

      {/* Footer */}
      <div className="p-2 border-t border-border bg-muted/40 text-[10px] text-muted-foreground">
        {componentLibrary.length} components · {categories.length} categories
      </div>
    </div>
  );
};

interface ComponentCardProps {
  component: (typeof componentLibrary)[number];
  isDragging: boolean;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  onClick: (id: string) => void;
}

const ComponentCard: React.FC<ComponentCardProps> = ({
  component,
  isDragging,
  onDragStart,
  onDragEnd,
  onClick,
}) => (
  <div
    draggable
    onDragStart={(e) => onDragStart(e, component.id)}
    onDragEnd={onDragEnd}
    onClick={() => onClick(component.id)}
    className={`
      p-2 rounded border cursor-pointer transition-all select-none
      ${
        isDragging
          ? 'bg-primary/20 border-primary/30 opacity-50'
          : 'bg-muted/40 border-border hover:bg-primary/10 hover:border-primary/50 active:bg-primary/30'
      }
    `}
  >
    <div className="flex items-center gap-2 mb-1">
      <div className="w-8 h-8 bg-background border border-border rounded flex items-center justify-center text-xs text-muted-foreground flex-shrink-0">
        <div
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(component.symbolSvg) }}
          className="w-6 h-6"
        />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-foreground truncate">{component.name}</p>
        <p className="text-[10px] text-muted-foreground truncate">{component.description}</p>
      </div>
    </div>

    <div className="flex flex-wrap gap-1">
      {component.tags.slice(0, 2).map((tag) => (
        <span
          key={tag}
          className="inline-block text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded"
        >
          {tag}
        </span>
      ))}
    </div>
  </div>
);

