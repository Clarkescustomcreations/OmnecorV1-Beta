import { ScrollView, Text, View, Pressable, FlatList } from "react-native";
import { useState } from "react";
import { ScreenContainer } from "@/components/screen-container";

interface ModelComponent {
  id: string;
  name: string;
  type: string;
  color: string;
}

export default function Viewer3DScreen() {
  const [viewMode, setViewMode] = useState<"3d" | "schematic" | "code">("3d");
  const [selectedComponent, setSelectedComponent] = useState<string | null>(null);
  const [components] = useState<ModelComponent[]>([
    { id: "1", name: "Cylinder", type: "Primitive", color: "#22C55E" },
    { id: "2", name: "Cube", type: "Primitive", color: "#EF4444" },
    { id: "3", name: "Sphere", type: "Primitive", color: "#0a7ea4" },
  ]);
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [aiQuery, setAIQuery] = useState("");

  const viewModes = [
    { id: "3d", label: "3D View" },
    { id: "schematic", label: "Schematic/PCB" },
    { id: "code", label: "Code" },
  ];

  return (
    <ScreenContainer className="flex-1 bg-background">
      {/* View Mode Selector */}
      <View className="bg-surface border-b border-border p-3 flex-row gap-2">
        {viewModes.map((mode) => (
          <Pressable
            key={mode.id}
            onPress={() => setViewMode(mode.id as "3d" | "schematic" | "code")}
            className={`flex-1 rounded-lg p-2 items-center ${
              viewMode === mode.id ? "bg-primary" : "bg-background border border-border"
            }`}
          >
            <Text
              className={`text-xs font-semibold ${
                viewMode === mode.id ? "text-background" : "text-foreground"
              }`}
            >
              {mode.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* 3D Viewer Area */}
      <View className="flex-1 bg-background border-b border-border items-center justify-center">
        {viewMode === "3d" && (
          <View className="flex-1 w-full items-center justify-center bg-gradient-to-b from-background to-surface">
            {/* Placeholder for 3D visualization */}
            <View className="w-32 h-32 rounded-full bg-primary/20 border-2 border-primary items-center justify-center">
              <Text className="text-foreground text-sm font-semibold">
                3D Model
              </Text>
            </View>
            <Text className="text-muted text-xs mt-4">
              Touch to rotate • Pinch to zoom
            </Text>
          </View>
        )}

        {viewMode === "schematic" && (
          <View className="flex-1 w-full items-center justify-center">
            <Text className="text-foreground text-base font-semibold mb-4">
              Schematic/PCB View
            </Text>
            <View className="w-40 h-40 bg-surface border-2 border-border rounded-lg items-center justify-center">
              <Text className="text-muted text-xs">PCB Layout</Text>
            </View>
          </View>
        )}

        {viewMode === "code" && (
          <ScrollView className="flex-1 w-full p-4">
            <Text className="font-mono text-xs text-muted">
              {`// 3D Model Code\ngeometry = new BoxGeometry(1, 1, 1);\nmaterial = new MeshStandardMaterial();\nmesh = new Mesh(geometry, material);\nscene.add(mesh);`}
            </Text>
          </ScrollView>
        )}
      </View>

      {/* Components List */}
      <View className="bg-surface border-b border-border p-3">
        <Text className="text-sm font-semibold text-foreground mb-2">
          Components
        </Text>
        <FlatList
          data={components}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => setSelectedComponent(item.id)}
              className={`flex-row items-center gap-3 p-2 rounded-lg mb-2 ${
                selectedComponent === item.id
                  ? "bg-primary/10 border border-primary"
                  : "bg-background border border-border"
              }`}
            >
              <View
                className="w-4 h-4 rounded"
                style={{ backgroundColor: item.color }}
              />
              <View className="flex-1">
                <Text
                  className={`text-sm font-semibold ${
                    selectedComponent === item.id
                      ? "text-primary"
                      : "text-foreground"
                  }`}
                >
                  {item.name}
                </Text>
                <Text className="text-xs text-muted">{item.type}</Text>
              </View>
            </Pressable>
          )}
          scrollEnabled={false}
        />
      </View>

      {/* AI Interaction Panel */}
      <View className="bg-surface border-t border-border p-4 gap-3">
        <Pressable
          onPress={() => setShowAIPanel(!showAIPanel)}
          className="bg-primary rounded-lg p-3 items-center active:opacity-80"
        >
          <Text className="text-background font-semibold">
            {showAIPanel ? "Hide AI Panel" : "Ask AI About This Model"}
          </Text>
        </Pressable>

        {showAIPanel && (
          <View className="bg-background border border-border rounded-lg p-3 gap-2">
            <Text className="text-xs text-muted">Ask AI for analysis or modifications</Text>
            <View className="flex-row gap-2">
              <Pressable className="flex-1 bg-surface border border-border rounded-lg p-2 items-center active:opacity-70">
                <Text className="text-foreground text-xs">Analyze</Text>
              </Pressable>
              <Pressable className="flex-1 bg-surface border border-border rounded-lg p-2 items-center active:opacity-70">
                <Text className="text-foreground text-xs">Modify</Text>
              </Pressable>
              <Pressable className="flex-1 bg-surface border border-border rounded-lg p-2 items-center active:opacity-70">
                <Text className="text-foreground text-xs">Export</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </ScreenContainer>
  );
}
