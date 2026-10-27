import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import LeadPanel from "@/components/LeadPanel";

export const LeadDrawer = ({ leadId, open, onOpenChange, assignees, courses, canAssign, canDelete, onChanged }) => (
  <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent
      side="right"
      data-testid="lead-drawer"
      className="w-full overflow-hidden border-l border-border/60 bg-background p-0 sm:max-w-[860px]"
    >
      <SheetTitle className="sr-only">Lead details</SheetTitle>
      {leadId && (
        <LeadPanel leadId={leadId} assignees={assignees} courses={courses} canAssign={canAssign} canDelete={canDelete} onChanged={onChanged} onDeleted={() => onOpenChange(false)} />
      )}
    </SheetContent>
  </Sheet>
);

export default LeadDrawer;
