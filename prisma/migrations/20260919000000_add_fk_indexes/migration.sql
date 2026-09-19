-- Missing indexes on FK columns (2026-09-15 bug review, "No indexes on any FK column").
-- Every query in app/, app/api/ and app/dashboard/ that filters or joins on one of these
-- columns was doing a sequential scan. Hand-written (no reachable dev DB in this worktree);
-- confirmed with `npx prisma validate` against the matching @@index lines in schema.prisma.
--
-- RoundTable.groupId is intentionally NOT indexed here — it already carries a single-column
-- UNIQUE constraint (`groupId String @unique`), which Postgres already backs with an index.
-- Adding a second one would be a pure duplicate.

CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

CREATE INDEX "Article_groupId_idx" ON "Article"("groupId");
CREATE INDEX "Article_section_idx" ON "Article"("section");
CREATE INDEX "Article_createdById_idx" ON "Article"("createdById");

CREATE INDEX "ArticleGroup_status_idx" ON "ArticleGroup"("status");

CREATE INDEX "LayoutBlock_groupId_idx" ON "LayoutBlock"("groupId");

CREATE INDEX "BlockSlot_blockId_idx" ON "BlockSlot"("blockId");
CREATE INDEX "BlockSlot_articleId_idx" ON "BlockSlot"("articleId");

CREATE INDEX "ArticleCredit_userId_idx" ON "ArticleCredit"("userId");
CREATE INDEX "ArticleCredit_articleId_idx" ON "ArticleCredit"("articleId");

CREATE INDEX "ArticleImage_articleId_idx" ON "ArticleImage"("articleId");

CREATE INDEX "RoundTableSide_roundTableId_idx" ON "RoundTableSide"("roundTableId");
CREATE INDEX "RoundTableTurn_sideId_idx" ON "RoundTableTurn"("sideId");

CREATE INDEX "Approval_articleId_idx" ON "Approval"("articleId");
CREATE INDEX "Approval_groupId_idx" ON "Approval"("groupId");
CREATE INDEX "Approval_userId_idx" ON "Approval"("userId");

CREATE INDEX "User_isPlaceholder_idx" ON "User"("isPlaceholder");
