import type { NormalizedResumeSkill } from '@talentflow/types';

/**
 * Canonical skill dictionary used to normalise the free text a resume (or an
 * LLM) produces into a stable spelling.
 *
 * Resumes spell the same skill a dozen ways — `ReactJS`, `react.js`, `React` —
 * and a recruiter searching for `React` has to find all of them. Every entry
 * carries the canonical `name`, a broad `category` (used for grouping and
 * matching facets) and the aliases people actually type. Matching is
 * case-insensitive and punctuation-insensitive, so `node.js` and `Node JS` land
 * on the same row.
 *
 * This is deliberately a curated, real catalogue rather than a stub: the value
 * of parsing is entirely in resolving to something searchable.
 */
export type SkillCategory =
  | 'PROGRAMMING_LANGUAGE'
  | 'FRONTEND'
  | 'BACKEND'
  | 'MOBILE'
  | 'DATABASE'
  | 'CLOUD'
  | 'DEVOPS'
  | 'DATA'
  | 'AI_ML'
  | 'TESTING'
  | 'SECURITY'
  | 'DESIGN'
  | 'PRODUCT'
  | 'METHODOLOGY'
  | 'MARKETING'
  | 'SALES'
  | 'FINANCE'
  | 'HR'
  | 'OPERATIONS'
  | 'HEALTHCARE'
  | 'ERP'
  | 'BUSINESS'
  | 'SOFT_SKILL'
  | 'LANGUAGE';

export interface SkillDictionaryEntry {
  name: string;
  category: SkillCategory;
  aliases: readonly string[];
}

export const SKILL_DICTIONARY: readonly SkillDictionaryEntry[] = [
  // --- Programming languages -------------------------------------------------
  { name: 'JavaScript', category: 'PROGRAMMING_LANGUAGE', aliases: ['JS', 'ECMAScript', 'ES6', 'ES2015'] },
  { name: 'TypeScript', category: 'PROGRAMMING_LANGUAGE', aliases: ['TS'] },
  { name: 'Python', category: 'PROGRAMMING_LANGUAGE', aliases: ['py', 'python3'] },
  { name: 'Java', category: 'PROGRAMMING_LANGUAGE', aliases: ['Java SE', 'Java EE'] },
  { name: 'C', category: 'PROGRAMMING_LANGUAGE', aliases: ['ANSI C'] },
  { name: 'C++', category: 'PROGRAMMING_LANGUAGE', aliases: ['CPP', 'C Plus Plus'] },
  { name: 'C#', category: 'PROGRAMMING_LANGUAGE', aliases: ['C Sharp', 'CSharp'] },
  { name: 'Go', category: 'PROGRAMMING_LANGUAGE', aliases: ['Golang'] },
  { name: 'Rust', category: 'PROGRAMMING_LANGUAGE', aliases: [] },
  { name: 'Ruby', category: 'PROGRAMMING_LANGUAGE', aliases: [] },
  { name: 'PHP', category: 'PROGRAMMING_LANGUAGE', aliases: [] },
  { name: 'Swift', category: 'PROGRAMMING_LANGUAGE', aliases: [] },
  { name: 'Kotlin', category: 'PROGRAMMING_LANGUAGE', aliases: [] },
  { name: 'Scala', category: 'PROGRAMMING_LANGUAGE', aliases: [] },
  { name: 'Elixir', category: 'PROGRAMMING_LANGUAGE', aliases: [] },
  { name: 'Erlang', category: 'PROGRAMMING_LANGUAGE', aliases: [] },
  { name: 'Haskell', category: 'PROGRAMMING_LANGUAGE', aliases: [] },
  { name: 'Clojure', category: 'PROGRAMMING_LANGUAGE', aliases: [] },
  { name: 'Dart', category: 'PROGRAMMING_LANGUAGE', aliases: [] },
  { name: 'R', category: 'PROGRAMMING_LANGUAGE', aliases: ['R Language'] },
  { name: 'MATLAB', category: 'PROGRAMMING_LANGUAGE', aliases: [] },
  { name: 'Perl', category: 'PROGRAMMING_LANGUAGE', aliases: [] },
  { name: 'Lua', category: 'PROGRAMMING_LANGUAGE', aliases: [] },
  { name: 'Groovy', category: 'PROGRAMMING_LANGUAGE', aliases: [] },
  { name: 'Objective-C', category: 'PROGRAMMING_LANGUAGE', aliases: ['ObjC', 'Obj-C'] },
  { name: 'Visual Basic', category: 'PROGRAMMING_LANGUAGE', aliases: ['VB.NET', 'VB'] },
  { name: 'Bash', category: 'PROGRAMMING_LANGUAGE', aliases: ['Shell', 'Shell Scripting', 'Bash Scripting'] },
  { name: 'PowerShell', category: 'PROGRAMMING_LANGUAGE', aliases: [] },
  { name: 'Solidity', category: 'PROGRAMMING_LANGUAGE', aliases: [] },

  // --- Frontend --------------------------------------------------------------
  { name: 'React', category: 'FRONTEND', aliases: ['React.js', 'ReactJS'] },
  { name: 'Next.js', category: 'FRONTEND', aliases: ['NextJS', 'Next'] },
  { name: 'Vue.js', category: 'FRONTEND', aliases: ['Vue', 'VueJS', 'Vue 3'] },
  { name: 'Nuxt.js', category: 'FRONTEND', aliases: ['Nuxt', 'NuxtJS'] },
  { name: 'Angular', category: 'FRONTEND', aliases: ['AngularJS', 'Angular 2+'] },
  { name: 'Svelte', category: 'FRONTEND', aliases: [] },
  { name: 'SvelteKit', category: 'FRONTEND', aliases: [] },
  { name: 'HTML', category: 'FRONTEND', aliases: ['HTML5'] },
  { name: 'CSS', category: 'FRONTEND', aliases: ['CSS3'] },
  { name: 'Sass', category: 'FRONTEND', aliases: ['SCSS'] },
  { name: 'Less', category: 'FRONTEND', aliases: ['Less.js'] },
  { name: 'Tailwind CSS', category: 'FRONTEND', aliases: ['Tailwind', 'TailwindCSS'] },
  { name: 'Bootstrap', category: 'FRONTEND', aliases: [] },
  { name: 'Material UI', category: 'FRONTEND', aliases: ['MUI'] },
  { name: 'Chakra UI', category: 'FRONTEND', aliases: ['Chakra'] },
  { name: 'Redux', category: 'FRONTEND', aliases: ['Redux Toolkit', 'RTK'] },
  { name: 'MobX', category: 'FRONTEND', aliases: [] },
  { name: 'Zustand', category: 'FRONTEND', aliases: [] },
  { name: 'React Query', category: 'FRONTEND', aliases: ['TanStack Query'] },
  { name: 'React Router', category: 'FRONTEND', aliases: [] },
  { name: 'Vite', category: 'FRONTEND', aliases: [] },
  { name: 'Webpack', category: 'FRONTEND', aliases: [] },
  { name: 'Rollup', category: 'FRONTEND', aliases: [] },
  { name: 'Babel', category: 'FRONTEND', aliases: [] },
  { name: 'ESLint', category: 'FRONTEND', aliases: [] },
  { name: 'Prettier', category: 'FRONTEND', aliases: [] },
  { name: 'jQuery', category: 'FRONTEND', aliases: [] },
  { name: 'Three.js', category: 'FRONTEND', aliases: ['ThreeJS'] },
  { name: 'D3.js', category: 'FRONTEND', aliases: ['D3'] },
  { name: 'Chart.js', category: 'FRONTEND', aliases: ['ChartJS'] },
  { name: 'Storybook', category: 'FRONTEND', aliases: [] },
  { name: 'Web Accessibility', category: 'FRONTEND', aliases: ['a11y', 'WCAG'] },
  { name: 'Progressive Web Apps', category: 'FRONTEND', aliases: ['PWA'] },
  { name: 'Web Components', category: 'FRONTEND', aliases: [] },
  { name: 'Responsive Design', category: 'FRONTEND', aliases: [] },
  { name: 'Framer Motion', category: 'FRONTEND', aliases: [] },
  { name: 'GSAP', category: 'FRONTEND', aliases: ['GreenSock'] },

  // --- Backend ---------------------------------------------------------------
  { name: 'Node.js', category: 'BACKEND', aliases: ['Node', 'NodeJS'] },
  { name: 'Express', category: 'BACKEND', aliases: ['Express.js'] },
  { name: 'Koa', category: 'BACKEND', aliases: ['Koa.js'] },
  { name: 'NestJS', category: 'BACKEND', aliases: ['Nest.js', 'Nest'] },
  { name: 'Fastify', category: 'BACKEND', aliases: [] },
  { name: 'Django', category: 'BACKEND', aliases: [] },
  { name: 'Flask', category: 'BACKEND', aliases: [] },
  { name: 'FastAPI', category: 'BACKEND', aliases: [] },
  { name: 'Spring', category: 'BACKEND', aliases: ['Spring Boot'] },
  { name: 'Ruby on Rails', category: 'BACKEND', aliases: ['Rails'] },
  { name: 'Laravel', category: 'BACKEND', aliases: [] },
  { name: 'Symfony', category: 'BACKEND', aliases: [] },
  { name: 'ASP.NET', category: 'BACKEND', aliases: ['.NET', '.NET Core', 'dotnet'] },
  { name: 'GraphQL', category: 'BACKEND', aliases: [] },
  { name: 'REST', category: 'BACKEND', aliases: ['REST API', 'RESTful API'] },
  { name: 'gRPC', category: 'BACKEND', aliases: [] },
  { name: 'WebSockets', category: 'BACKEND', aliases: ['WebSocket'] },
  { name: 'Microservices', category: 'BACKEND', aliases: ['Microservice Architecture'] },
  { name: 'Serverless', category: 'BACKEND', aliases: [] },
  { name: 'RabbitMQ', category: 'BACKEND', aliases: [] },
  { name: 'Apache Kafka', category: 'BACKEND', aliases: ['Kafka'] },
  { name: 'Memcached', category: 'BACKEND', aliases: [] },
  { name: 'Nginx', category: 'BACKEND', aliases: [] },
  { name: 'Apache HTTP Server', category: 'BACKEND', aliases: ['Apache'] },
  { name: 'Elasticsearch', category: 'BACKEND', aliases: ['Elastic Search'] },
  { name: 'OpenAPI', category: 'BACKEND', aliases: ['Swagger'] },
  { name: 'JWT', category: 'BACKEND', aliases: ['JSON Web Token'] },
  { name: 'Socket.IO', category: 'BACKEND', aliases: ['SocketIO'] },

  // --- Mobile ----------------------------------------------------------------
  { name: 'React Native', category: 'MOBILE', aliases: [] },
  { name: 'Flutter', category: 'MOBILE', aliases: [] },
  { name: 'Ionic', category: 'MOBILE', aliases: [] },
  { name: 'Xamarin', category: 'MOBILE', aliases: [] },
  { name: 'SwiftUI', category: 'MOBILE', aliases: [] },
  { name: 'Jetpack Compose', category: 'MOBILE', aliases: [] },
  { name: 'Android', category: 'MOBILE', aliases: ['Android SDK'] },
  { name: 'iOS', category: 'MOBILE', aliases: ['iOS Development'] },
  { name: 'Apache Cordova', category: 'MOBILE', aliases: ['Cordova', 'PhoneGap'] },
  { name: 'Expo', category: 'MOBILE', aliases: [] },
  { name: 'Unity', category: 'MOBILE', aliases: ['Unity3D'] },

  // --- Database --------------------------------------------------------------
  { name: 'PostgreSQL', category: 'DATABASE', aliases: ['Postgres', 'psql'] },
  { name: 'MySQL', category: 'DATABASE', aliases: [] },
  { name: 'MariaDB', category: 'DATABASE', aliases: [] },
  { name: 'Microsoft SQL Server', category: 'DATABASE', aliases: ['SQL Server', 'MSSQL', 'T-SQL'] },
  { name: 'Oracle Database', category: 'DATABASE', aliases: ['Oracle DB', 'PL/SQL'] },
  { name: 'SQLite', category: 'DATABASE', aliases: [] },
  { name: 'MongoDB', category: 'DATABASE', aliases: [] },
  { name: 'Apache Cassandra', category: 'DATABASE', aliases: ['Cassandra'] },
  { name: 'DynamoDB', category: 'DATABASE', aliases: [] },
  { name: 'Couchbase', category: 'DATABASE', aliases: [] },
  { name: 'Neo4j', category: 'DATABASE', aliases: [] },
  { name: 'Firebase', category: 'DATABASE', aliases: ['Firestore'] },
  { name: 'Supabase', category: 'DATABASE', aliases: [] },
  { name: 'Redis', category: 'DATABASE', aliases: [] },
  { name: 'Prisma', category: 'DATABASE', aliases: [] },
  { name: 'TypeORM', category: 'DATABASE', aliases: [] },
  { name: 'Sequelize', category: 'DATABASE', aliases: [] },
  { name: 'Mongoose', category: 'DATABASE', aliases: [] },
  { name: 'Hibernate', category: 'DATABASE', aliases: [] },
  { name: 'Entity Framework', category: 'DATABASE', aliases: [] },
  { name: 'Knex.js', category: 'DATABASE', aliases: ['Knex'] },
  { name: 'Database Design', category: 'DATABASE', aliases: ['Data Modeling', 'Query Optimization'] },
  { name: 'pgvector', category: 'DATABASE', aliases: ['Vector Database'] },

  // --- Cloud -----------------------------------------------------------------
  { name: 'AWS', category: 'CLOUD', aliases: ['Amazon Web Services'] },
  { name: 'Microsoft Azure', category: 'CLOUD', aliases: ['Azure'] },
  { name: 'Google Cloud Platform', category: 'CLOUD', aliases: ['GCP', 'Google Cloud'] },
  { name: 'DigitalOcean', category: 'CLOUD', aliases: [] },
  { name: 'Heroku', category: 'CLOUD', aliases: [] },
  { name: 'Vercel', category: 'CLOUD', aliases: [] },
  { name: 'Netlify', category: 'CLOUD', aliases: [] },
  { name: 'Cloudflare', category: 'CLOUD', aliases: [] },
  { name: 'AWS EC2', category: 'CLOUD', aliases: ['EC2'] },
  { name: 'AWS S3', category: 'CLOUD', aliases: ['S3', 'Simple Storage Service'] },
  { name: 'AWS Lambda', category: 'CLOUD', aliases: ['Lambda'] },
  { name: 'CloudFront', category: 'CLOUD', aliases: [] },
  { name: 'Amazon RDS', category: 'CLOUD', aliases: ['RDS'] },
  { name: 'Serverless Framework', category: 'CLOUD', aliases: [] },

  // --- DevOps ----------------------------------------------------------------
  { name: 'Docker', category: 'DEVOPS', aliases: [] },
  { name: 'Kubernetes', category: 'DEVOPS', aliases: ['K8s'] },
  { name: 'Helm', category: 'DEVOPS', aliases: [] },
  { name: 'Terraform', category: 'DEVOPS', aliases: [] },
  { name: 'Ansible', category: 'DEVOPS', aliases: [] },
  { name: 'Jenkins', category: 'DEVOPS', aliases: [] },
  { name: 'GitHub Actions', category: 'DEVOPS', aliases: [] },
  { name: 'GitLab CI', category: 'DEVOPS', aliases: ['GitLab CI/CD'] },
  { name: 'CircleCI', category: 'DEVOPS', aliases: [] },
  { name: 'ArgoCD', category: 'DEVOPS', aliases: ['Argo CD'] },
  { name: 'Prometheus', category: 'DEVOPS', aliases: [] },
  { name: 'Grafana', category: 'DEVOPS', aliases: [] },
  { name: 'Datadog', category: 'DEVOPS', aliases: [] },
  { name: 'New Relic', category: 'DEVOPS', aliases: [] },
  { name: 'Splunk', category: 'DEVOPS', aliases: [] },
  { name: 'ELK Stack', category: 'DEVOPS', aliases: ['Elastic Stack', 'Kibana', 'Logstash'] },
  { name: 'CI/CD', category: 'DEVOPS', aliases: ['Continuous Integration', 'Continuous Delivery', 'Continuous Deployment'] },
  { name: 'Infrastructure as Code', category: 'DEVOPS', aliases: ['IaC'] },
  { name: 'Linux', category: 'DEVOPS', aliases: ['Unix'] },
  { name: 'Windows Server', category: 'DEVOPS', aliases: [] },
  { name: 'Git', category: 'DEVOPS', aliases: [] },
  { name: 'GitHub', category: 'DEVOPS', aliases: [] },
  { name: 'GitLab', category: 'DEVOPS', aliases: [] },
  { name: 'Bitbucket', category: 'DEVOPS', aliases: [] },
  { name: 'Site Reliability Engineering', category: 'DEVOPS', aliases: ['SRE'] },
  { name: 'Istio', category: 'DEVOPS', aliases: [] },
  { name: 'HashiCorp Vault', category: 'DEVOPS', aliases: ['Vault'] },
  { name: 'HashiCorp Consul', category: 'DEVOPS', aliases: ['Consul'] },

  // --- Data ------------------------------------------------------------------
  { name: 'Apache Spark', category: 'DATA', aliases: ['Spark', 'PySpark'] },
  { name: 'Hadoop', category: 'DATA', aliases: ['Apache Hadoop'] },
  { name: 'Apache Hive', category: 'DATA', aliases: ['Hive'] },
  { name: 'Apache Airflow', category: 'DATA', aliases: ['Airflow'] },
  { name: 'dbt', category: 'DATA', aliases: ['Data Build Tool'] },
  { name: 'Snowflake', category: 'DATA', aliases: [] },
  { name: 'BigQuery', category: 'DATA', aliases: ['Google BigQuery'] },
  { name: 'Amazon Redshift', category: 'DATA', aliases: ['Redshift'] },
  { name: 'Databricks', category: 'DATA', aliases: [] },
  { name: 'ETL', category: 'DATA', aliases: ['Extract Transform Load'] },
  { name: 'Data Warehousing', category: 'DATA', aliases: ['Data Warehouse'] },
  { name: 'Data Pipelines', category: 'DATA', aliases: ['Data Engineering'] },
  { name: 'Pandas', category: 'DATA', aliases: [] },
  { name: 'NumPy', category: 'DATA', aliases: [] },
  { name: 'Matplotlib', category: 'DATA', aliases: [] },
  { name: 'Jupyter', category: 'DATA', aliases: ['Jupyter Notebook'] },
  { name: 'Tableau', category: 'DATA', aliases: [] },
  { name: 'Power BI', category: 'DATA', aliases: ['PowerBI'] },
  { name: 'Looker', category: 'DATA', aliases: ['Looker Studio'] },
  { name: 'Apache Flink', category: 'DATA', aliases: ['Flink'] },
  { name: 'Apache Beam', category: 'DATA', aliases: ['Beam'] },
  { name: 'Data Visualization', category: 'DATA', aliases: [] },
  { name: 'Statistics', category: 'DATA', aliases: ['Statistical Analysis'] },
  { name: 'A/B Testing', category: 'DATA', aliases: ['AB Testing'] },

  // --- AI / ML ---------------------------------------------------------------
  { name: 'Machine Learning', category: 'AI_ML', aliases: ['ML'] },
  { name: 'Deep Learning', category: 'AI_ML', aliases: [] },
  { name: 'TensorFlow', category: 'AI_ML', aliases: [] },
  { name: 'PyTorch', category: 'AI_ML', aliases: [] },
  { name: 'Keras', category: 'AI_ML', aliases: [] },
  { name: 'scikit-learn', category: 'AI_ML', aliases: ['sklearn', 'Scikit Learn'] },
  { name: 'XGBoost', category: 'AI_ML', aliases: [] },
  { name: 'Natural Language Processing', category: 'AI_ML', aliases: ['NLP'] },
  { name: 'Computer Vision', category: 'AI_ML', aliases: ['CV'] },
  { name: 'Large Language Models', category: 'AI_ML', aliases: ['LLM', 'LLMs'] },
  { name: 'Generative AI', category: 'AI_ML', aliases: ['GenAI', 'Gen AI'] },
  { name: 'Prompt Engineering', category: 'AI_ML', aliases: [] },
  { name: 'LangChain', category: 'AI_ML', aliases: [] },
  { name: 'LlamaIndex', category: 'AI_ML', aliases: ['GPT Index'] },
  { name: 'Hugging Face', category: 'AI_ML', aliases: ['HuggingFace'] },
  { name: 'OpenAI API', category: 'AI_ML', aliases: ['GPT', 'GPT-4'] },
  { name: 'Reinforcement Learning', category: 'AI_ML', aliases: ['RL'] },
  { name: 'MLOps', category: 'AI_ML', aliases: [] },
  { name: 'Feature Engineering', category: 'AI_ML', aliases: [] },
  { name: 'OpenCV', category: 'AI_ML', aliases: [] },
  { name: 'spaCy', category: 'AI_ML', aliases: [] },
  { name: 'Transformers', category: 'AI_ML', aliases: ['Hugging Face Transformers'] },

  // --- Testing ---------------------------------------------------------------
  { name: 'Jest', category: 'TESTING', aliases: [] },
  { name: 'Mocha', category: 'TESTING', aliases: [] },
  { name: 'Chai', category: 'TESTING', aliases: [] },
  { name: 'Cypress', category: 'TESTING', aliases: [] },
  { name: 'Playwright', category: 'TESTING', aliases: [] },
  { name: 'Selenium', category: 'TESTING', aliases: [] },
  { name: 'Puppeteer', category: 'TESTING', aliases: [] },
  { name: 'Vitest', category: 'TESTING', aliases: [] },
  { name: 'React Testing Library', category: 'TESTING', aliases: ['RTL'] },
  { name: 'JUnit', category: 'TESTING', aliases: [] },
  { name: 'PyTest', category: 'TESTING', aliases: [] },
  { name: 'RSpec', category: 'TESTING', aliases: [] },
  { name: 'Postman', category: 'TESTING', aliases: [] },
  { name: 'JMeter', category: 'TESTING', aliases: ['Apache JMeter'] },
  { name: 'Unit Testing', category: 'TESTING', aliases: [] },
  { name: 'Integration Testing', category: 'TESTING', aliases: [] },
  { name: 'End-to-End Testing', category: 'TESTING', aliases: ['E2E Testing'] },
  { name: 'Test Automation', category: 'TESTING', aliases: [] },
  { name: 'TDD', category: 'TESTING', aliases: ['Test Driven Development'] },
  { name: 'Load Testing', category: 'TESTING', aliases: ['Performance Testing'] },

  // --- Security --------------------------------------------------------------
  { name: 'Penetration Testing', category: 'SECURITY', aliases: ['Pen Testing', 'Pentesting'] },
  { name: 'OWASP', category: 'SECURITY', aliases: [] },
  { name: 'Burp Suite', category: 'SECURITY', aliases: [] },
  { name: 'Metasploit', category: 'SECURITY', aliases: [] },
  { name: 'Wireshark', category: 'SECURITY', aliases: [] },
  { name: 'Nmap', category: 'SECURITY', aliases: [] },
  { name: 'Kali Linux', category: 'SECURITY', aliases: [] },
  { name: 'Ethical Hacking', category: 'SECURITY', aliases: [] },
  { name: 'Cryptography', category: 'SECURITY', aliases: [] },
  { name: 'Network Security', category: 'SECURITY', aliases: [] },
  { name: 'Application Security', category: 'SECURITY', aliases: ['AppSec'] },
  { name: 'Identity and Access Management', category: 'SECURITY', aliases: ['IAM'] },
  { name: 'Single Sign-On', category: 'SECURITY', aliases: ['SSO'] },
  { name: 'OAuth', category: 'SECURITY', aliases: ['OAuth2', 'OAuth 2.0'] },
  { name: 'SAML', category: 'SECURITY', aliases: [] },
  { name: 'SOC 2', category: 'SECURITY', aliases: [] },
  { name: 'ISO 27001', category: 'SECURITY', aliases: [] },
  { name: 'GDPR', category: 'SECURITY', aliases: [] },
  { name: 'HIPAA', category: 'SECURITY', aliases: [] },
  { name: 'Threat Modeling', category: 'SECURITY', aliases: [] },
  { name: 'Vulnerability Assessment', category: 'SECURITY', aliases: [] },

  // --- Design ----------------------------------------------------------------
  { name: 'Figma', category: 'DESIGN', aliases: [] },
  { name: 'Sketch', category: 'DESIGN', aliases: [] },
  { name: 'Adobe XD', category: 'DESIGN', aliases: [] },
  { name: 'Adobe Photoshop', category: 'DESIGN', aliases: ['Photoshop'] },
  { name: 'Adobe Illustrator', category: 'DESIGN', aliases: ['Illustrator'] },
  { name: 'InVision', category: 'DESIGN', aliases: [] },
  { name: 'UI Design', category: 'DESIGN', aliases: ['User Interface Design'] },
  { name: 'UX Design', category: 'DESIGN', aliases: ['User Experience', 'UX'] },
  { name: 'User Research', category: 'DESIGN', aliases: [] },
  { name: 'Wireframing', category: 'DESIGN', aliases: ['Wireframes'] },
  { name: 'Prototyping', category: 'DESIGN', aliases: [] },
  { name: 'Design Systems', category: 'DESIGN', aliases: [] },
  { name: 'Interaction Design', category: 'DESIGN', aliases: [] },
  { name: 'Graphic Design', category: 'DESIGN', aliases: [] },
  { name: 'Branding', category: 'DESIGN', aliases: ['Brand Identity'] },
  { name: 'Typography', category: 'DESIGN', aliases: [] },
  { name: 'Motion Design', category: 'DESIGN', aliases: [] },
  { name: 'Adobe After Effects', category: 'DESIGN', aliases: ['After Effects'] },
  { name: 'Inclusive Design', category: 'DESIGN', aliases: [] },

  // --- Product ---------------------------------------------------------------
  { name: 'Product Management', category: 'PRODUCT', aliases: [] },
  { name: 'Product Strategy', category: 'PRODUCT', aliases: [] },
  { name: 'Roadmapping', category: 'PRODUCT', aliases: ['Product Roadmap'] },
  { name: 'Jira', category: 'PRODUCT', aliases: [] },
  { name: 'Confluence', category: 'PRODUCT', aliases: [] },
  { name: 'Trello', category: 'PRODUCT', aliases: [] },
  { name: 'Asana', category: 'PRODUCT', aliases: [] },
  { name: 'Notion', category: 'PRODUCT', aliases: [] },
  { name: 'Product Analytics', category: 'PRODUCT', aliases: [] },
  { name: 'OKRs', category: 'PRODUCT', aliases: ['Objectives and Key Results'] },
  { name: 'User Stories', category: 'PRODUCT', aliases: [] },
  { name: 'Stakeholder Management', category: 'PRODUCT', aliases: [] },
  { name: 'Design Thinking', category: 'PRODUCT', aliases: [] },

  // --- Methodology -----------------------------------------------------------
  { name: 'Agile', category: 'METHODOLOGY', aliases: ['Agile Methodology'] },
  { name: 'Scrum', category: 'METHODOLOGY', aliases: [] },
  { name: 'Kanban', category: 'METHODOLOGY', aliases: [] },
  { name: 'SAFe', category: 'METHODOLOGY', aliases: ['Scaled Agile Framework'] },
  { name: 'Code Review', category: 'METHODOLOGY', aliases: [] },
  { name: 'Refactoring', category: 'METHODOLOGY', aliases: [] },
  { name: 'Clean Code', category: 'METHODOLOGY', aliases: [] },
  { name: 'SOLID Principles', category: 'METHODOLOGY', aliases: ['SOLID'] },
  { name: 'Design Patterns', category: 'METHODOLOGY', aliases: [] },
  { name: 'Domain-Driven Design', category: 'METHODOLOGY', aliases: ['DDD'] },
  { name: 'Pair Programming', category: 'METHODOLOGY', aliases: [] },

  // --- Marketing -------------------------------------------------------------
  { name: 'SEO', category: 'MARKETING', aliases: ['Search Engine Optimization'] },
  { name: 'SEM', category: 'MARKETING', aliases: ['Search Engine Marketing'] },
  { name: 'Content Marketing', category: 'MARKETING', aliases: [] },
  { name: 'Email Marketing', category: 'MARKETING', aliases: [] },
  { name: 'Social Media Marketing', category: 'MARKETING', aliases: ['SMM'] },
  { name: 'Google Analytics', category: 'MARKETING', aliases: ['GA4'] },
  { name: 'Google Ads', category: 'MARKETING', aliases: ['AdWords'] },
  { name: 'Meta Ads', category: 'MARKETING', aliases: ['Facebook Ads'] },
  { name: 'Marketing Automation', category: 'MARKETING', aliases: [] },
  { name: 'HubSpot', category: 'MARKETING', aliases: [] },
  { name: 'Mailchimp', category: 'MARKETING', aliases: [] },
  { name: 'Copywriting', category: 'MARKETING', aliases: [] },
  { name: 'Brand Management', category: 'MARKETING', aliases: [] },
  { name: 'Conversion Rate Optimization', category: 'MARKETING', aliases: ['CRO'] },
  { name: 'Public Relations', category: 'MARKETING', aliases: ['PR'] },
  { name: 'Community Management', category: 'MARKETING', aliases: [] },
  { name: 'Google Tag Manager', category: 'MARKETING', aliases: ['GTM'] },

  // --- Sales -----------------------------------------------------------------
  { name: 'Salesforce', category: 'SALES', aliases: ['Salesforce CRM'] },
  { name: 'CRM', category: 'SALES', aliases: ['Customer Relationship Management'] },
  { name: 'Lead Generation', category: 'SALES', aliases: [] },
  { name: 'Cold Calling', category: 'SALES', aliases: [] },
  { name: 'Negotiation', category: 'SALES', aliases: [] },
  { name: 'Account Management', category: 'SALES', aliases: ['Key Account Management'] },
  { name: 'Business Development', category: 'SALES', aliases: [] },
  { name: 'B2B Sales', category: 'SALES', aliases: [] },
  { name: 'Sales Funnel', category: 'SALES', aliases: ['Pipeline Management'] },
  { name: 'Customer Success', category: 'SALES', aliases: [] },
  { name: 'Zoho CRM', category: 'SALES', aliases: ['Zoho'] },
  { name: 'Pre-sales', category: 'SALES', aliases: ['Presales'] },
  { name: 'Solution Selling', category: 'SALES', aliases: [] },

  // --- Finance ---------------------------------------------------------------
  { name: 'Financial Analysis', category: 'FINANCE', aliases: [] },
  { name: 'Financial Modeling', category: 'FINANCE', aliases: [] },
  { name: 'Forecasting', category: 'FINANCE', aliases: [] },
  { name: 'Budgeting', category: 'FINANCE', aliases: [] },
  { name: 'Accounting', category: 'FINANCE', aliases: [] },
  { name: 'Bookkeeping', category: 'FINANCE', aliases: [] },
  { name: 'QuickBooks', category: 'FINANCE', aliases: [] },
  { name: 'Tally', category: 'FINANCE', aliases: ['Tally ERP'] },
  { name: 'GAAP', category: 'FINANCE', aliases: [] },
  { name: 'IFRS', category: 'FINANCE', aliases: [] },
  { name: 'Auditing', category: 'FINANCE', aliases: ['Audit'] },
  { name: 'Taxation', category: 'FINANCE', aliases: ['Tax Preparation'] },
  { name: 'Payroll', category: 'FINANCE', aliases: [] },
  { name: 'Accounts Payable', category: 'FINANCE', aliases: [] },
  { name: 'Accounts Receivable', category: 'FINANCE', aliases: [] },
  { name: 'Reconciliation', category: 'FINANCE', aliases: [] },
  { name: 'Cost Accounting', category: 'FINANCE', aliases: [] },
  { name: 'Risk Management', category: 'FINANCE', aliases: [] },
  { name: 'Microsoft Excel', category: 'FINANCE', aliases: ['Excel', 'MS Excel'] },

  // --- HR --------------------------------------------------------------------
  { name: 'Recruitment', category: 'HR', aliases: [] },
  { name: 'Talent Acquisition', category: 'HR', aliases: [] },
  { name: 'Onboarding', category: 'HR', aliases: [] },
  { name: 'Employee Engagement', category: 'HR', aliases: [] },
  { name: 'Performance Management', category: 'HR', aliases: [] },
  { name: 'HRIS', category: 'HR', aliases: ['HRMS', 'HR Information System'] },
  { name: 'Workday', category: 'HR', aliases: [] },
  { name: 'BambooHR', category: 'HR', aliases: [] },
  { name: 'Compensation and Benefits', category: 'HR', aliases: ['Compensation', 'C&B'] },
  { name: 'Learning and Development', category: 'HR', aliases: ['L&D'] },
  { name: 'Succession Planning', category: 'HR', aliases: [] },
  { name: 'Employee Relations', category: 'HR', aliases: [] },
  { name: 'Applicant Tracking System', category: 'HR', aliases: ['ATS'] },
  { name: 'Interviewing', category: 'HR', aliases: [] },
  { name: 'Sourcing', category: 'HR', aliases: ['Talent Sourcing'] },
  { name: 'Boolean Search', category: 'HR', aliases: [] },
  { name: 'Employer Branding', category: 'HR', aliases: [] },
  { name: 'Diversity and Inclusion', category: 'HR', aliases: ['D&I', 'DEI'] },
  { name: 'People Analytics', category: 'HR', aliases: ['HR Analytics'] },

  // --- Operations ------------------------------------------------------------
  { name: 'Supply Chain Management', category: 'OPERATIONS', aliases: [] },
  { name: 'Logistics', category: 'OPERATIONS', aliases: [] },
  { name: 'Inventory Management', category: 'OPERATIONS', aliases: [] },
  { name: 'Procurement', category: 'OPERATIONS', aliases: [] },
  { name: 'Vendor Management', category: 'OPERATIONS', aliases: [] },
  { name: 'Process Improvement', category: 'OPERATIONS', aliases: [] },
  { name: 'Lean', category: 'OPERATIONS', aliases: ['Lean Manufacturing'] },
  { name: 'Six Sigma', category: 'OPERATIONS', aliases: [] },
  { name: 'Kaizen', category: 'OPERATIONS', aliases: [] },
  { name: 'Project Management', category: 'OPERATIONS', aliases: [] },
  { name: 'PMP', category: 'OPERATIONS', aliases: ['Project Management Professional'] },
  { name: 'PRINCE2', category: 'OPERATIONS', aliases: [] },
  { name: 'Quality Assurance', category: 'OPERATIONS', aliases: ['QA'] },
  { name: 'Quality Control', category: 'OPERATIONS', aliases: [] },
  { name: 'Operations Management', category: 'OPERATIONS', aliases: [] },
  { name: 'Business Process Management', category: 'OPERATIONS', aliases: ['BPM'] },
  { name: 'ITIL', category: 'OPERATIONS', aliases: [] },

  // --- Healthcare ------------------------------------------------------------
  { name: 'Electronic Health Records', category: 'HEALTHCARE', aliases: ['EHR', 'EMR'] },
  { name: 'Clinical Research', category: 'HEALTHCARE', aliases: [] },
  { name: 'Patient Care', category: 'HEALTHCARE', aliases: [] },
  { name: 'Medical Coding', category: 'HEALTHCARE', aliases: ['ICD-10', 'CPT Coding'] },
  { name: 'Nursing', category: 'HEALTHCARE', aliases: [] },
  { name: 'Pharmacology', category: 'HEALTHCARE', aliases: [] },
  { name: 'Telemedicine', category: 'HEALTHCARE', aliases: [] },
  { name: 'HL7', category: 'HEALTHCARE', aliases: ['FHIR'] },
  { name: 'Medical Billing', category: 'HEALTHCARE', aliases: [] },
  { name: 'Pharmacovigilance', category: 'HEALTHCARE', aliases: [] },
  { name: 'Clinical Trials', category: 'HEALTHCARE', aliases: ['Good Clinical Practice', 'GCP'] },
  { name: 'Regulatory Affairs', category: 'HEALTHCARE', aliases: [] },
  { name: 'Medical Terminology', category: 'HEALTHCARE', aliases: [] },

  // --- ERP / business systems ------------------------------------------------
  { name: 'SAP', category: 'ERP', aliases: ['SAP ERP'] },
  { name: 'SAP HANA', category: 'ERP', aliases: [] },
  { name: 'Microsoft Dynamics', category: 'ERP', aliases: ['Dynamics 365'] },
  { name: 'NetSuite', category: 'ERP', aliases: ['Oracle NetSuite'] },
  { name: 'Odoo', category: 'ERP', aliases: [] },
  { name: 'Sage', category: 'ERP', aliases: [] },
  { name: 'Epicor', category: 'ERP', aliases: [] },
  { name: 'Infor', category: 'ERP', aliases: [] },

  // --- Business analysis -----------------------------------------------------
  { name: 'Business Analysis', category: 'BUSINESS', aliases: ['Business Analyst'] },
  { name: 'Requirements Gathering', category: 'BUSINESS', aliases: [] },
  { name: 'User Acceptance Testing', category: 'BUSINESS', aliases: ['UAT'] },
  { name: 'Gap Analysis', category: 'BUSINESS', aliases: [] },
  { name: 'SWOT Analysis', category: 'BUSINESS', aliases: ['SWOT'] },
  { name: 'Business Intelligence', category: 'BUSINESS', aliases: ['BI'] },
  { name: 'Data Analysis', category: 'BUSINESS', aliases: ['Data Analytics'] },
  { name: 'Robotic Process Automation', category: 'BUSINESS', aliases: ['RPA'] },
  { name: 'UiPath', category: 'BUSINESS', aliases: [] },
  { name: 'Automation Anywhere', category: 'BUSINESS', aliases: [] },
  { name: 'Microsoft Visio', category: 'BUSINESS', aliases: ['Visio'] },
  { name: 'Microsoft Project', category: 'BUSINESS', aliases: ['MS Project'] },

  // --- Soft skills -----------------------------------------------------------
  { name: 'Communication', category: 'SOFT_SKILL', aliases: [] },
  { name: 'Teamwork', category: 'SOFT_SKILL', aliases: ['Team Player'] },
  { name: 'Leadership', category: 'SOFT_SKILL', aliases: [] },
  { name: 'Problem Solving', category: 'SOFT_SKILL', aliases: [] },
  { name: 'Critical Thinking', category: 'SOFT_SKILL', aliases: [] },
  { name: 'Time Management', category: 'SOFT_SKILL', aliases: [] },
  { name: 'Adaptability', category: 'SOFT_SKILL', aliases: [] },
  { name: 'Collaboration', category: 'SOFT_SKILL', aliases: [] },
  { name: 'Creativity', category: 'SOFT_SKILL', aliases: [] },
  { name: 'Attention to Detail', category: 'SOFT_SKILL', aliases: [] },
  { name: 'Emotional Intelligence', category: 'SOFT_SKILL', aliases: ['EQ'] },
  { name: 'Conflict Resolution', category: 'SOFT_SKILL', aliases: [] },
  { name: 'Decision Making', category: 'SOFT_SKILL', aliases: [] },
  { name: 'Mentoring', category: 'SOFT_SKILL', aliases: [] },
  { name: 'Coaching', category: 'SOFT_SKILL', aliases: [] },
  { name: 'Presentation Skills', category: 'SOFT_SKILL', aliases: [] },
  { name: 'Public Speaking', category: 'SOFT_SKILL', aliases: [] },
  { name: 'Interpersonal Skills', category: 'SOFT_SKILL', aliases: [] },
  { name: 'Organizational Skills', category: 'SOFT_SKILL', aliases: [] },
  { name: 'Customer Service', category: 'SOFT_SKILL', aliases: [] },
  { name: 'Active Listening', category: 'SOFT_SKILL', aliases: [] },
  { name: 'Analytical Thinking', category: 'SOFT_SKILL', aliases: [] },
  { name: 'Strategic Thinking', category: 'SOFT_SKILL', aliases: [] },
  { name: 'Team Management', category: 'SOFT_SKILL', aliases: [] },
  { name: 'Delegation', category: 'SOFT_SKILL', aliases: [] },

  // --- Spoken languages ------------------------------------------------------
  { name: 'English', category: 'LANGUAGE', aliases: [] },
  { name: 'Spanish', category: 'LANGUAGE', aliases: [] },
  { name: 'French', category: 'LANGUAGE', aliases: [] },
  { name: 'German', category: 'LANGUAGE', aliases: [] },
  { name: 'Mandarin Chinese', category: 'LANGUAGE', aliases: ['Mandarin', 'Chinese'] },
  { name: 'Hindi', category: 'LANGUAGE', aliases: [] },
  { name: 'Arabic', category: 'LANGUAGE', aliases: [] },
  { name: 'Portuguese', category: 'LANGUAGE', aliases: [] },
  { name: 'Japanese', category: 'LANGUAGE', aliases: [] },
  { name: 'Russian', category: 'LANGUAGE', aliases: [] },
  { name: 'Bengali', category: 'LANGUAGE', aliases: [] },
  { name: 'Marathi', category: 'LANGUAGE', aliases: [] },
  { name: 'Tamil', category: 'LANGUAGE', aliases: [] },
  { name: 'Telugu', category: 'LANGUAGE', aliases: [] },
  { name: 'Urdu', category: 'LANGUAGE', aliases: [] },
  { name: 'Punjabi', category: 'LANGUAGE', aliases: [] },
  { name: 'Gujarati', category: 'LANGUAGE', aliases: [] },
  { name: 'Korean', category: 'LANGUAGE', aliases: [] },
  { name: 'Italian', category: 'LANGUAGE', aliases: [] },
  { name: 'Dutch', category: 'LANGUAGE', aliases: [] },
  { name: 'Turkish', category: 'LANGUAGE', aliases: [] },
];

/** Lower-cases, strips punctuation (keeping `+ # .`) and collapses whitespace. */
function normalizeKey(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The same, with spaces and dots removed — so `react.js` matches `reactjs`. */
function squashKey(value: string): string {
  return normalizeKey(value).replace(/[^a-z0-9+#]/g, '');
}

const SKILL_INDEX: Map<string, SkillDictionaryEntry> = (() => {
  const index = new Map<string, SkillDictionaryEntry>();
  for (const entry of SKILL_DICTIONARY) {
    for (const spelling of [entry.name, ...entry.aliases]) {
      const key = normalizeKey(spelling);
      if (key && !index.has(key)) index.set(key, entry);
      const squashed = squashKey(spelling);
      if (squashed && !index.has(squashed)) index.set(squashed, entry);
    }
  }
  return index;
})();

/** Resolves a free-text skill to its canonical dictionary entry, if known. */
export function matchSkill(raw: string): SkillDictionaryEntry | undefined {
  const key = normalizeKey(raw);
  if (!key) return undefined;
  return SKILL_INDEX.get(key) ?? SKILL_INDEX.get(squashKey(raw));
}

function toTitleCase(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

/**
 * Turns raw parsed skills into normalised entries: canonical spelling for
 * known skills, a cleaned-up guess for the rest, and de-duplication so a resume
 * listing `React` twice yields one row.
 */
export function normalizeResumeSkills(
  skills: ReadonlyArray<{ name: string; years: number | null; level: number | null }>,
): NormalizedResumeSkill[] {
  const seen = new Set<string>();
  const out: NormalizedResumeSkill[] = [];

  for (const skill of skills) {
    const name = skill.name.trim();
    if (!name) continue;

    const entry = matchSkill(name);
    const matchedName = entry?.name ?? toTitleCase(name);
    const dedupeKey = matchedName.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    out.push({
      name,
      matchedName,
      skillId: null,
      category: entry?.category ?? null,
      years: skill.years ?? null,
      level: skill.level ?? null,
    });

    if (out.length >= 120) break;
  }

  return out;
}
