# Security Policy for Omnecor

Omnecor is committed to providing a secure and robust environment for managing your AI workflows. This document outlines the security measures implemented within Omnecor and best practices for users to maintain a secure setup.

## 1. Core Security Features

Omnecor incorporates several security features to protect your data and system:

-   **Local-First Data Sovereignty**: By design, Omnecor prioritizes local data storage. Your sensitive project data and AI models reside on your machine, minimizing exposure to external threats. Cloud synchronization is optional and user-controlled.

-   **Rate Limiting**: The Express server implements rate limiting to prevent abuse and denial-of-service attacks. This helps ensure the stability and availability of the Omnecor application.

-   **CSRF and Path Traversal Protection**: Backend middleware is in place to enforce secure resource access, protecting against Cross-Site Request Forgery (CSRF) and path traversal vulnerabilities.

-   **Data Encryption**: Sensitive local project data is protected using AES-256-GCM encryption, ensuring confidentiality and integrity.

-   **Authentication and Authorization**: Omnecor includes mechanisms for user authentication (e.g., via OAuth routes) and authorization to control access to features and data. The `SecurityService` manages these aspects internally.

-   **Secure Storage Proxy**: A secure storage proxy is implemented to handle interactions with external storage, ensuring that data transfers are managed safely.

-   **OMMESH Security**: The OMMESH distributed mesh intelligence layer federates securely via mTLS (mutual Transport Layer Security), ensuring authenticated and encrypted communication between Omnecor nodes.

## 2. Best Practices for Users

To enhance the security of your Omnecor installation, we recommend the following best practices:

-   **Keep Your System Updated**: Regularly update your operating system, Node.js, and Omnecor to benefit from the latest security patches and improvements.

-   **Strong Passwords/Credentials**: If Omnecor integrates with external services requiring credentials, use strong, unique passwords and consider using a password manager.

-   **Network Security**: Ensure your local network is secure. Use firewalls and secure Wi-Fi configurations to prevent unauthorized access to your Omnecor instance.

-   **Environment Variable Management**: Store sensitive information, such as API keys, in your `.env` file and ensure this file is not committed to version control. Follow secure practices for managing environment variables.

-   **Regular Backups**: Implement a regular backup strategy for your `~/.omnecor` directory and Drizzle-managed database files to ensure data recovery in case of system failure or data loss.

-   **Monitor Logs**: Periodically review Omnecor logs (located in `server/_core/logs`) for any unusual activity or error messages that might indicate a security concern.

## 3. Reporting Security Vulnerabilities

If you discover a security vulnerability in Omnecor, please report it responsibly by contacting the maintainers directly. Do not disclose the vulnerability publicly until it has been addressed.

## 4. License

This security policy is part of the Omnecor project, which is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
