"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { WorkspaceSidebar } from "./workspace-sidebar";
import { WorkspaceHeader } from "./workspace-header";
import { NewDocumentModal } from "./new-document-modal";
import { HelpGuidesModal } from "./help-guides-modal";

interface WorkspaceShellProps {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    role?: string;
  };
  children: React.ReactNode;
}

function WorkspaceShellInner({
  user,
  children,
}: WorkspaceShellProps) {
  const pathname = usePathname();
  const {
    isNewDocumentModalOpen,
    closeNewDocumentModal,
    modalInitialDocType,
    isHelpGuidesOpen,
    closeHelpGuides,
  } = useWorkspace();

  const isEditorCanvas = pathname.startsWith("/editor/") && pathname !== "/editor";

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50">
      {/* 1. Persistent Left Sidebar */}
      <WorkspaceSidebar user={user} />

      {/* 2. Workspace Content Column */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* On Editor Canvas, EditorHeader handles the document toolbar.
            On all other routes, render the minimal WorkspaceHeader */}
        {!isEditorCanvas && <WorkspaceHeader user={user} />}

        {/* Scrollable Content Container */}
        <main
          className={`flex-1 min-w-0 ${
            isEditorCanvas ? "h-full overflow-hidden" : "overflow-y-auto"
          }`}
        >
          {children}
        </main>
      </div>

      {/* 3. Global Modal Triggers */}
      <NewDocumentModal
        isOpen={isNewDocumentModalOpen}
        onClose={closeNewDocumentModal}
        initialDocType={modalInitialDocType}
      />

      <HelpGuidesModal
        isOpen={isHelpGuidesOpen}
        onClose={closeHelpGuides}
      />
    </div>
  );
}

export function WorkspaceShell({ user, children }: WorkspaceShellProps) {
  return (
    <WorkspaceProvider>
      <WorkspaceShellInner user={user}>{children}</WorkspaceShellInner>
    </WorkspaceProvider>
  );
}
