export interface PageCreationResult {
  id: string;
}

export interface TaskCreationResult {
  id: string;
}

export interface ScrapedContent {
  title: string;
  sections: string[];
  links: Array<{ href: string; text: string }>;
  text: string;
}

export interface CreatePageParams {
  parentPageId: string;
  title: string;
  icon?: string;
  sourceUrl?: string;
  scrapedContent?: ScrapedContent;
  rawMessage?: string;
}

export interface CreateTaskParams {
  databaseId: string;
  message: string;
  titleProperty?: string;
  dueDate?: string;
  assigneeIds?: string[];
  priority?: string;
}

export interface INotionApiClient {
  createPage(params: CreatePageParams): Promise<PageCreationResult>;
  createTask(params: CreateTaskParams): Promise<TaskCreationResult>;
}
