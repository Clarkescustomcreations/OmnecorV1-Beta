import React, { useState } from "react";
import { useFictionMode } from "@/contexts/FictionModeContext";
import { FictionNodeType } from "@/types/fiction";
import { Plus, Users, BookOpen, Clock, Heart, MapPin, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

export default function FictionModePanel() {
  const { fictionState, addFictionNode, addTimelineEvent, updateLore } = useFictionMode();
  const [activeTab, setActiveTab] = useState("lore");

  // Local state for forms
  const [loreKey, setLoreKey] = useState("");
  const [loreValue, setLoreValue] = useState("");

  const [charName, setCharName] = useState("");
  const [charDesc, setCharDesc] = useState("");

  const [eventTitle, setEventTitle] = useState("");
  const [eventDesc, setEventDesc] = useState("");
  const [eventOrder, setEventOrder] = useState(0);

  const handleAddLore = () => {
    if (!loreKey || !loreValue) return;
    updateLore(loreKey, loreValue);
    setLoreKey("");
    setLoreValue("");
  };

  const handleAddCharacter = () => {
    if (!charName) return;
    addFictionNode({
      type: "character",
      label: charName,
      description: charDesc,
    });
    setCharName("");
    setCharDesc("");
  };

  const handleAddEvent = () => {
    if (!eventTitle) return;
    addTimelineEvent({
      title: eventTitle,
      description: eventDesc,
      timestamp: new Date().toISOString(),
      order: eventOrder,
    });
    setEventTitle("");
    setEventDesc("");
    setEventOrder(prev => prev + 1);
  };

  return (
    <div className="flex flex-col h-full gap-4 p-2">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <h2 className="text-lg font-semibold text-accent flex items-center gap-2">
          <Heart className="w-5 h-5 text-accent fill-accent/20" />
          Fiction Workspace
        </h2>
        <Badge variant="outline" className="border-accent text-accent bg-accent/5">
          Sandboxed
        </Badge>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="lore" className="gap-2">
            <BookOpen className="w-4 h-4" /> Lore
          </TabsTrigger>
          <TabsTrigger value="characters" className="gap-2">
            <Users className="w-4 h-4" /> Cast
          </TabsTrigger>
          <TabsTrigger value="timeline" className="gap-2">
            <Clock className="w-4 h-4" /> Timeline
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 mt-4 overflow-hidden">
          {/* LORE TAB */}
          <TabsContent value="lore" className="h-full flex flex-col gap-4 m-0 data-[state=inactive]:hidden">
            <div className="space-y-3 border border-border p-3 rounded-lg bg-muted/20">
              <Input
                placeholder="Lore Entry Topic (e.g., The Force)"
                value={loreKey}
                onChange={e => setLoreKey(e.target.value)}
              />
              <Textarea
                placeholder="Detailed description of lore element..."
                value={loreValue}
                onChange={e => setLoreValue(e.target.value)}
              />
              <Button size="sm" className="w-full gap-2" onClick={handleAddLore}>
                <Plus className="w-4 h-4" /> Add Lore Entry
              </Button>
            </div>
            <ScrollArea className="flex-1 pr-2">
              <div className="space-y-3">
                {Object.entries(fictionState.lore).map(([key, value]) => (
                  <Card key={key}>
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <Tag className="w-4 h-4 text-accent" />
                        {key}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0 text-xs text-muted-foreground whitespace-pre-wrap">
                      {value}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* CHARACTERS TAB */}
          <TabsContent value="characters" className="h-full flex flex-col gap-4 m-0 data-[state=inactive]:hidden">
            <div className="space-y-3 border border-border p-3 rounded-lg bg-muted/20">
              <Input
                placeholder="Character Name"
                value={charName}
                onChange={e => setCharName(e.target.value)}
              />
              <Textarea
                placeholder="Backstory, traits, or narrative importance..."
                value={charDesc}
                onChange={e => setCharDesc(e.target.value)}
              />
              <Button size="sm" className="w-full gap-2" onClick={handleAddCharacter}>
                <Plus className="w-4 h-4" /> Register Character
              </Button>
            </div>
            <ScrollArea className="flex-1 pr-2">
              <div className="grid grid-cols-1 gap-3">
                {fictionState.nodes
                  .filter(n => n.type === "character")
                  .map(node => (
                    <Card key={node.id}>
                      <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                          <Users className="w-4 h-4 text-accent" />
                          {node.label}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0 text-xs text-muted-foreground">
                        {node.description}
                      </CardContent>
                    </Card>
                  ))}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* TIMELINE TAB */}
          <TabsContent value="timeline" className="h-full flex flex-col gap-4 m-0 data-[state=inactive]:hidden">
            <div className="space-y-3 border border-border p-3 rounded-lg bg-muted/20">
              <div className="flex gap-2">
                <Input
                  placeholder="Event Title"
                  className="flex-1"
                  value={eventTitle}
                  onChange={e => setEventTitle(e.target.value)}
                />
                <Input
                  type="number"
                  placeholder="Order"
                  className="w-20"
                  value={eventOrder}
                  onChange={e => setEventOrder(parseInt(e.target.value) || 0)}
                />
              </div>
              <Textarea
                placeholder="What occurs during this scene/event?"
                value={eventDesc}
                onChange={e => setEventDesc(e.target.value)}
              />
              <Button size="sm" className="w-full gap-2" onClick={handleAddEvent}>
                <Plus className="w-4 h-4" /> Add Timeline Event
              </Button>
            </div>
            <ScrollArea className="flex-1 pr-2">
              <div className="relative border-l-2 border-border ml-3 pl-4 space-y-4 py-2">
                {fictionState.timeline.map(event => (
                  <div key={event.id} className="relative">
                    <span className="absolute -left-[25px] top-1 bg-background border-2 border-accent w-3 h-3 rounded-full flex items-center justify-center" />
                    <div className="space-y-1">
                      <span className="text-[10px] text-accent font-semibold">
                        Sequence #{event.order}
                      </span>
                      <h4 className="text-sm font-semibold text-foreground">{event.title}</h4>
                      <p className="text-xs text-muted-foreground">{event.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
