import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, FileText, Shield } from "lucide-react";
import logoMark from "../../../assets/logo_mark_256.png";
import { TOS_SECTIONS, TOS_VERSION, TOS_EFFECTIVE_DATE } from "@/lib/tosContent";

export function TermsPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="border-b bg-card/80 backdrop-blur-xl sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground" onClick={() => window.history.back()}>
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <img src={logoMark} alt="Omnecor" className="w-6 h-6 object-contain" />
            <span className="font-black tracking-tighter text-sm">OMNECOR</span>
          </div>
          <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
            v{TOS_VERSION}
          </Badge>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-6 py-12 flex-1 w-full">
        {/* Title */}
        <div className="mb-10 space-y-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20">
              <FileText className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight">Terms of Service</h1>
              <p className="text-sm text-muted-foreground">Effective date: {TOS_EFFECTIVE_DATE}</p>
            </div>
          </div>
          <div className="p-4 rounded-xl bg-muted/30 border border-border/50 flex gap-3">
            <Shield className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              Omnecor is a free, open-source local AI workstation. These terms exist to protect both users and the project.
              They are intentionally written in plain language.
            </p>
          </div>
        </div>

        {/* Sections */}
        <div className="space-y-10">
          {TOS_SECTIONS.map((section) => (
            <div key={section.title} className="space-y-3">
              <h2 className="text-base font-bold text-foreground border-b pb-2">{section.title}</h2>
              {section.body.map((paragraph, i) => (
                <p key={i} className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                  {paragraph}
                </p>
              ))}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-border/50 space-y-4">
          <p className="text-xs text-muted-foreground">
            For questions or concerns, please open an issue on the Omnecor GitHub profile.
          </p>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>Omnecor HMCI</span>
            <span>·</span>
            <span>Terms v{TOS_VERSION}</span>
            <span>·</span>
            <span>Effective {TOS_EFFECTIVE_DATE}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
