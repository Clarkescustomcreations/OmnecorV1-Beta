import { ProcessManagerService } from "./ProcessManagerService.js";
import { createLogger } from "../../_core/logger.js";

const log = createLogger("DockerService");

/**
 * DockerService
 * Manages Docker containers for sandboxing and dynamic infrastructure.
 * Based on reference deployment client.
 */
export class DockerService {
  private static instance: DockerService | null = null;
  private processManager: ProcessManagerService;

  private constructor() {
    this.processManager = ProcessManagerService.getInstance();
  }

  public static getInstance(): DockerService {
    if (!DockerService.instance) {
      DockerService.instance = new DockerService();
    }
    return DockerService.instance;
  }

  /**
   * Run a command inside a new Docker container (sandboxed execution)
   */
  async runInSandbox(image: string, command: string[]): Promise<string> {
    log.info(`Running command in sandbox: ${image} -> ${command.join(" ")}`);
    
    return this.processManager.spawn({
      type: "custom",
      command: "docker",
      args: ["run", "--rm", image, ...command],
      label: `Docker Sandbox: ${image}`,
    });
  }

  /**
   * List running containers
   */
  async listContainers(): Promise<string> {
    return this.processManager.spawn({
      type: "custom",
      command: "docker",
      args: ["ps", "--format", "json"],
      label: "Docker List",
    });
  }

  /**
   * Stop a container
   */
  async stopContainer(containerId: string): Promise<string> {
    return this.processManager.spawn({
      type: "custom",
      command: "docker",
      args: ["stop", containerId],
      label: `Docker Stop: ${containerId}`,
    });
  }
}
