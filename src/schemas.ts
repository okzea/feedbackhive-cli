import { z } from "zod"

const MAX_PROJECT_TITLE_LENGTH = 50

export const ListProjectsSchema = z.object({
  status: z.string().optional(),
  visibility: z.string().optional(),
  tag: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(25),
})

export const CreateProjectSchema = z.object({
  title: z.string().min(1, "Title is required").max(MAX_PROJECT_TITLE_LENGTH),
  description: z.string().optional(),
  visibility: z.string().optional(),
  status: z.string().optional(),
  allowComments: z.boolean().optional(),
  requireApproval: z.boolean().optional(),
  taskPricingEnabled: z.boolean().optional(),
  taskPricingCurrency: z.string().optional(),
  taskStatuses: z.unknown().optional(),
  tags: z.array(z.string().max(20)).optional(),
})

export const GetProjectSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
})

export const ListTasksSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  status: z.string().optional(),
  assigneeId: z.string().optional(),
  updatedSince: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
})

export const GetTaskSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  taskId: z.string().min(1, "Task ID is required"),
})

export const ListCommentsSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  taskId: z.string().min(1, "Task ID is required"),
  limit: z.number().int().min(1).max(100).default(50),
})

export const CreateCommentSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  taskId: z.string().min(1, "Task ID is required"),
  content: z.string().min(1, "Content is required"),
})

export const ListNotesSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  includeContent: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
})

export const GetNoteSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  noteId: z.string().min(1, "Note ID is required"),
})

export const CreateNoteSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  title: z.string().max(200).optional(),
  content: z.string().optional(),
  folderId: z.string().optional(),
  isPinned: z.boolean().optional(),
})

export const UpdateNoteSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  noteId: z.string().min(1, "Note ID is required"),
  title: z.string().max(200).optional(),
  content: z.string().optional(),
  folderId: z.string().nullable().optional(),
  isPinned: z.boolean().optional(),
})

export const DeleteNoteSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  noteId: z.string().min(1, "Note ID is required"),
})

export const CreateTaskSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  title: z.string().min(1, "Title is required").max(70),
  description: z.string().optional(),
  status: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  assigneeId: z.string().optional(),
  dueDate: z.string().optional(),
  taskGroupId: z.string().optional(),
  tags: z.array(z.string().max(20)).optional(),
  price: z.union([z.string(), z.number(), z.null()]).optional(),
})

export const UpdateTaskSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  taskId: z.string().min(1, "Task ID is required"),
  title: z.string().min(1).max(70).optional(),
  description: z.string().optional(),
  status: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  assigneeId: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  taskGroupId: z.string().nullable().optional(),
  price: z.union([z.string(), z.number(), z.null()]).optional(),
})

export const DeleteTaskSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  taskId: z.string().min(1, "Task ID is required"),
})

export const ListTaskGroupsSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
})

export const CreateTaskGroupSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  name: z.string().min(1, "Name is required").max(50),
  icon: z.string().min(1).max(50).optional(),
  iconColor: z.string().min(1).max(30).optional(),
  order: z.number().int().optional(),
})

export const UpdateTaskGroupSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  groupId: z.string().min(1, "Task group ID is required"),
  name: z.string().min(1).max(50).optional(),
  icon: z.string().min(1).max(50).optional(),
  iconColor: z.string().min(1).max(30).optional(),
  order: z.number().int().optional(),
})

export const DeleteTaskGroupSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  groupId: z.string().min(1, "Task group ID is required"),
})

export const ListNoteFoldersSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
})

export const CreateNoteFolderSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  name: z.string().min(1, "Name is required").max(50),
  icon: z.string().min(1).max(50).optional(),
  iconColor: z.string().min(1).max(30).optional(),
  order: z.number().int().optional(),
})

export const UpdateNoteFolderSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  folderId: z.string().min(1, "Folder ID is required"),
  name: z.string().min(1).max(50).optional(),
  icon: z.string().min(1).max(50).optional(),
  iconColor: z.string().min(1).max(30).optional(),
  order: z.number().int().optional(),
})

export const DeleteNoteFolderSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  folderId: z.string().min(1, "Folder ID is required"),
})

export type ListProjectsInput = z.infer<typeof ListProjectsSchema>
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>
export type GetProjectInput = z.infer<typeof GetProjectSchema>
export type ListTasksInput = z.infer<typeof ListTasksSchema>
export type GetTaskInput = z.infer<typeof GetTaskSchema>
export type ListCommentsInput = z.infer<typeof ListCommentsSchema>
export type CreateCommentInput = z.infer<typeof CreateCommentSchema>
export type ListNotesInput = z.infer<typeof ListNotesSchema>
export type GetNoteInput = z.infer<typeof GetNoteSchema>
export type CreateNoteInput = z.infer<typeof CreateNoteSchema>
export type UpdateNoteInput = z.infer<typeof UpdateNoteSchema>
export type DeleteNoteInput = z.infer<typeof DeleteNoteSchema>
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>
export type DeleteTaskInput = z.infer<typeof DeleteTaskSchema>
export type ListTaskGroupsInput = z.infer<typeof ListTaskGroupsSchema>
export type CreateTaskGroupInput = z.infer<typeof CreateTaskGroupSchema>
export type UpdateTaskGroupInput = z.infer<typeof UpdateTaskGroupSchema>
export type DeleteTaskGroupInput = z.infer<typeof DeleteTaskGroupSchema>
export type ListNoteFoldersInput = z.infer<typeof ListNoteFoldersSchema>
export type CreateNoteFolderInput = z.infer<typeof CreateNoteFolderSchema>
export type UpdateNoteFolderInput = z.infer<typeof UpdateNoteFolderSchema>
export type DeleteNoteFolderInput = z.infer<typeof DeleteNoteFolderSchema>
