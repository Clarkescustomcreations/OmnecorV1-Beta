import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Card, CardContent } from '@/components/ui/card';
import { FileCode, FileText, Image as ImageIcon, File, Terminal, Hash } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type FileNodeData = {
  label: string;
  path: string;
  language: string;
  size: number;
  modified: string;
};

const getFileIcon = (filename: string, language?: string) => {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (language === 'typescript' || language === 'javascript' || ['ts', 'tsx', 'js', 'jsx'].includes(ext || '')) {
    return <FileCode className="w-4 h-4 text-blue-400" />;
  }
  if (['md', 'txt'].includes(ext || '')) {
    return <FileText className="w-4 h-4 text-muted-foreground" />;
  }
  if (['png', 'jpg', 'jpeg', 'svg', 'webp'].includes(ext || '')) {
    return <ImageIcon className="w-4 h-4 text-purple-400" />;
  }
  if (['json', 'yml', 'yaml'].includes(ext || '')) {
    return <Hash className="w-4 h-4 text-orange-400" />;
  }
  if (['sh', 'bash', 'py'].includes(ext || '')) {
    return <Terminal className="w-4 h-4 text-green-400" />;
  }
  return <File className="w-4 h-4 text-muted-foreground" />;
};

const formatSize = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const FileNode = ({ data, selected }: NodeProps<FileNodeData>) => {
  return (
    <div className={cn(
      "transition-all duration-200",
      selected ? "ring-2 ring-blue-500 rounded-lg" : ""
    )}>
      <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-muted-foreground" />
      
      <Card className="min-w-[150px] bg-card/90 backdrop-blur-sm border-border shadow-lg">
        <CardContent className="p-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-muted rounded-md">
              {getFileIcon(data.label, data.language)}
            </div>
            <div className="flex flex-col overflow-hidden">
              <span className="text-sm font-medium truncate max-w-[120px]" title={data.label}>
                {data.label}
              </span>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">
                  {formatSize(data.size)}
                </Badge>
                {data.language && (
                  <span className="text-[10px] text-muted-foreground uppercase">
                    {data.language}
                  </span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-muted-foreground" />
    </div>
  );
};

export default memo(FileNode);
