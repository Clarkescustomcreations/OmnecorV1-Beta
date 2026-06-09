import re

with open("client/src/pages/Settings.tsx", "r") as f:
    content = f.read()

# Add imports
import_lucide = 'import { Key, Shield, HardDrive, Cpu, Bell, Lock, Zap, Flame, Activity, Users, Download, CheckCircle2, Circle, Route, Sun, Moon, Monitor, Cloud, UserCircle2, CheckCircle, ArrowLeft, Wallet, Settings as SettingsIcon, FolderOpen, Settings2, Trash2, Plus, AlertCircle, Upload, Save, Loader2 } from "lucide-react";'
content = re.sub(r'import { Key.*lucide-react";', import_lucide, content)

import_select = 'import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";'
content = content.replace('import { Slider } from "../components/ui/slider";', 'import { Slider } from "../components/ui/slider";\n' + import_select)

# Add tabs
tabs_list_addition = """
            <TabsTrigger value="general"><SettingsIcon className="w-4 h-4 mr-2" /> General</TabsTrigger>
            <TabsTrigger value="knowledge"><FolderOpen className="w-4 h-4 mr-2" /> Knowledge Base</TabsTrigger>
            <TabsTrigger value="privacy"><Lock className="w-4 h-4 mr-2" /> Privacy</TabsTrigger>
            <TabsTrigger value="advanced"><Settings2 className="w-4 h-4 mr-2" /> Advanced</TabsTrigger>
"""
content = content.replace('{isAdmin && <TabsTrigger value="admin"><Activity className="w-4 h-4 mr-2" /> Admin</TabsTrigger>}', tabs_list_addition.strip() + '\n            {isAdmin && <TabsTrigger value="admin"><Activity className="w-4 h-4 mr-2" /> Admin</TabsTrigger>}')

# Add Tab Contents
tabs_content_addition = """
          <TabsContent value="general">
            <GeneralPanel />
          </TabsContent>

          <TabsContent value="knowledge">
            <KnowledgePanel />
          </TabsContent>

          <TabsContent value="privacy">
            <PrivacyPanel />
          </TabsContent>

          <TabsContent value="advanced">
            <AdvancedPanel />
          </TabsContent>
"""
content = content.replace('<TabsContent value="appearance">\n            <AppearancePanel />\n          </TabsContent>', '<TabsContent value="appearance">\n            <AppearancePanel />\n          </TabsContent>\n' + tabs_content_addition)

# Add Missing Panels Code at the end before export default Settings;
panels_code = """
const GeneralPanel: React.FC = () => {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Behavior</CardTitle>
          <CardDescription>Configure application behavior</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Auto-Save</Label>
            <Switch defaultChecked />
          </div>
          <div className="flex items-center justify-between">
            <Label>Notifications</Label>
            <Switch defaultChecked />
          </div>
          <div className="space-y-2">
            <Label>Startup Behavior</Label>
            <Select defaultValue="dashboard">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="last-session">Restore Last Session</SelectItem>
                <SelectItem value="blank">Blank Workspace</SelectItem>
                <SelectItem value="dashboard">Dashboard</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

const KnowledgePanel: React.FC = () => {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Knowledge Base Folders</CardTitle>
              <CardDescription>Manage indexed project folders</CardDescription>
            </div>
            <Button size="sm"><Plus className="w-4 h-4 mr-2" />Add Folder</Button>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-64">
            <div className="space-y-2">
              <div className="p-3 rounded-lg border bg-muted/50 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Omnecor Source</p>
                  <p className="text-xs text-muted-foreground font-mono">/home/linux/Documents/Omnecor</p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch defaultChecked />
                  <Button size="sm" variant="ghost"><Trash2 className="w-4 h-4" /></Button>
                </div>
              </div>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Indexing Settings</CardTitle>
          <CardDescription>Configure automatic indexing behavior</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Auto-Index</Label>
            <Switch defaultChecked />
          </div>
          <div className="space-y-2">
            <Label>Index Interval (minutes)</Label>
            <Slider defaultValue={[15]} min={5} max={240} step={5} />
          </div>
          <div className="space-y-2">
            <Label>Max File Size (MB)</Label>
            <Slider defaultValue={[50]} min={10} max={500} step={10} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

const PrivacyPanel: React.FC = () => {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Data Privacy</CardTitle>
          <CardDescription>Control how your data is handled</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Zero-Login Mode</Label>
              <p className="text-xs text-muted-foreground">All data stays local</p>
            </div>
            <Switch />
          </div>
          <div className="flex items-center justify-between">
            <Label>Telemetry</Label>
            <Switch />
          </div>
          <div className="flex items-center justify-between">
            <Label>Crash Reports</Label>
            <Switch />
          </div>
          <div className="flex items-center justify-between">
            <Label>Analytics</Label>
            <Switch />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Cloud Sync</CardTitle>
          <CardDescription>Optional encrypted cloud backup</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Enable Cloud Sync</Label>
            <Switch />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

const AdvancedPanel: React.FC = () => {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>AI Model Defaults</CardTitle>
          <CardDescription>Configure default model parameters</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Temperature</Label>
            <Slider defaultValue={[0.7]} min={0} max={2} step={0.1} />
          </div>
          <div className="space-y-2">
            <Label>Top P</Label>
            <Slider defaultValue={[1]} min={0} max={1} step={0.05} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Developer Options</CardTitle>
          <CardDescription>Advanced debugging and performance tuning</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Debug Mode</Label>
            <Switch />
          </div>
          <div className="flex items-center justify-between">
            <Label>Enable Dev Tools</Label>
            <Switch />
          </div>
          <div className="flex items-center justify-between">
            <Label>Enable Cache</Label>
            <Switch defaultChecked />
          </div>
          <div className="space-y-2">
            <Label>Log Level</Label>
            <Select defaultValue="info">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="debug">Debug</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warn">Warning</SelectItem>
                <SelectItem value="error">Error</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
"""
content = content.replace('export default Settings;', panels_code + '\nexport default Settings;')

# Appearance panel modification (add Font Size and Language)
appearance_replacement = """const AppearancePanel: React.FC = () => {
  const { theme, setTheme } = useTheme();
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Monitor className="w-4 h-4" /> Theme</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 max-w-md">
            {THEME_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setTheme(opt.value)}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-lg border-2 p-4 text-sm font-medium transition-colors",
                  theme === opt.value ? "border-primary bg-primary/10 text-primary" : "border-border bg-background"
                )}
              >
                {opt.icon}
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Display Preferences</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 max-w-md">
            <Label>Font Size (px)</Label>
            <Slider defaultValue={[14]} min={12} max={18} step={1} />
          </div>
          <div className="space-y-2 max-w-md">
            <Label>Language</Label>
            <Select defaultValue="en">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="es">Español</SelectItem>
                <SelectItem value="fr">Français</SelectItem>
                <SelectItem value="de">Deutsch</SelectItem>
                <SelectItem value="zh">中文</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};"""
content = re.sub(r'const AppearancePanel: React\.FC = \(\) => \{.*?\n\};\n', appearance_replacement + "\n", content, flags=re.DOTALL)

# Security panel modification (add Malicious File Scan, Scan on upload, Blacklist, Encrypt API Keys, Session Timeout)
# It's inside the main Settings component under <TabsContent value="security">
security_append = """
                <div className="pt-6 border-t space-y-6">
                  <h3 className="text-lg font-semibold">File Security</h3>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Malicious File Scan</Label>
                      <p className="text-xs text-muted-foreground">Scan uploaded files for threats.</p>
                    </div>
                    <Switch defaultChecked />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>Scan on Upload</Label>
                    <Switch defaultChecked />
                  </div>
                  <div className="space-y-2">
                    <Label>Blacklisted File Types</Label>
                    <div className="flex flex-wrap gap-2">
                      {['.exe', '.bat', '.sh'].map(type => (
                        <Badge key={type} variant="secondary" className="cursor-pointer">
                          {type}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="pt-6 border-t space-y-6">
                  <h3 className="text-lg font-semibold">Encryption Settings</h3>
                  <div className="flex items-center justify-between">
                    <Label>Encrypt API Keys</Label>
                    <Switch defaultChecked />
                  </div>
                  <div className="space-y-2">
                    <Label>Session Timeout (minutes)</Label>
                    <Slider defaultValue={[30]} min={5} max={480} step={5} />
                  </div>
                </div>
"""
content = content.replace('<Switch id="local-encryption" />\n                </div>\n              </CardContent>', '<Switch id="local-encryption" />\n                </div>' + security_append + '\n              </CardContent>')

with open("client/src/pages/Settings.tsx", "w") as f:
    f.write(content)

print("Settings patched successfully.")
