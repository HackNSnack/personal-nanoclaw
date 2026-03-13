## Mathias Pettersen 

# Weekly report – Week 3 

Hello everyone! It’s been quite some time since the previous weekly update. There was a lot to get done by the end of last year, and additionally I got sick at the end of it, so it was a bit hectic – hence the lack of weeklies😅 

However, now we’re back! The past weeks, both before and after new year’s, have consisted of mainly preparing everything for the eval-API to be deployed. And as of today – it is finally deployed! We’ve done a lot of preparation and architecture discussions that build on this new Python-backend, so it’s very nice to be able to continue and build on top of it. 

## Progress 

* Done in-depth review w/other team members of the new Python AI-backend (where the eval API lies), going through all the new code and doing cleaning, fixing etc. 
* Presented the AI backend to the team, showcasing SOLID principles and how they affected development of the AI backend. Subsequently, we had discussions on how much abstraction was needed – leading to a reduction in the abstraction layers 
* Got ADR on aforementioned system approved and merged 
* Additionally, we attempted to solve a JSON schema problem with Vertex AI and our MCP server. This is still in progress, and seems like an error on Google’s side 
* Lastly, we started preparing our main repo (devops-monorepo) for AI-tool support, adding CLAUDE.md files and Github workflows to allow Claude to review the code in PRs (and work better in local development). 

## Comments 

* There’s a lot of things to do currently, and there have been a lot of issues hanging on the deployment of the eval API 
* Now that we’ve finally got it out the door, hopefully development on the new AI architecture can gain substantial speed 

## Next week 

* Do testing of eval API & start implementing an API endpoint to talk to ConfidentAI 
* Hopefully start work on the AI architecture shift